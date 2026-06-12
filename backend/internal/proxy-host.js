import { createReadStream } from "node:fs";
import { access as fsAccess, mkdir, readdir, rm, truncate } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import _ from "lodash";
import errs from "../lib/error.js";
import { castJsonIfNeed } from "../lib/helpers.js";
import utils from "../lib/utils.js";
import proxyHostModel from "../models/proxy_host.js";
import internalAuditLog from "./audit-log.js";
import internalCertificate from "./certificate.js";
import internalHost from "./host.js";
import internalNginx from "./nginx.js";
import internalProxyHostAccessList from "./proxy-host-access-list.js";

const omissions = () => {
	return ["is_deleted", "owner.is_deleted"];
};

const accessLogPath = process.env.NPMPLUS_ACCESS_LOG || "/data/nginx/logs/access.log";
const analyticsRetentionDays = Number.parseInt(process.env.NPMPLUS_ANALYTICS_RETENTION_DAYS || "3", 10);

const emptyAnalytics = () => ({
	total_requests: 0,
	total_bytes_sent: 0,
	average_request_time: 0,
	uptime_percent: 0,
	last_seen: null,
	statuses: {},
	methods: {},
	top_paths: [],
});

const parseAccessLogLine = (line) => {
	const match = line.match(
		/^\[([^\]]+)\]\s+(\S+)\s+\S+\s+([0-9.]+)\s+"([A-Z]+)\s+([^"]*?)\s+HTTP\/[^"]+"\s+(\d{3})\s+(\d+|-)\s+\d+\s+/,
	);
	if (!match) {
		return null;
	}

	return {
		timestamp: Date.parse(match[1].replace(":", " ")),
		host: match[2],
		requestTime: Number.parseFloat(match[3]) || 0,
		method: match[4],
		path: match[5] || "/",
		status: Number.parseInt(match[6], 10),
		bytesSent: match[7] === "-" ? 0 : Number.parseInt(match[7], 10),
	};
};

const normalizeAnalytics = (stats) => ({
	total_requests: stats.total_requests,
	total_bytes_sent: stats.total_bytes_sent,
	average_request_time:
		stats.total_requests > 0 ? Number((stats.total_request_time / stats.total_requests).toFixed(4)) : 0,
	uptime_percent:
		stats.total_requests > 0 ? Number(((stats.successful_requests / stats.total_requests) * 100).toFixed(3)) : 0,
	last_seen: stats.last_seen ? new Date(stats.last_seen).toISOString() : null,
	statuses: stats.statuses,
	methods: stats.methods,
	top_paths: Object.entries(stats.paths)
		.map(([path, requests]) => ({ path, requests }))
		.sort((a, b) => b.requests - a.requests || a.path.localeCompare(b.path))
		.slice(0, 25),
});

const internalProxyHost = {
	/**
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @returns {Promise}
	 */
	create: (access, data) => {
		let thisData = data;
		const createCertificate = thisData.certificate_id === "new";

		if (createCertificate) {
			delete thisData.certificate_id;
		}
		data.npmplus_access_list_ids = data.npmplus_access_list_ids || [];
		data.npmplus_access_list_type = data.npmplus_access_list_type || "public";
		return access
			.can("proxy_hosts:create", thisData)
			.then(() => {
				// Get a list of the domain names and check each of them against existing records
				const domain_name_check_promises = [];

				thisData.domain_names.map((domain_name) => {
					domain_name_check_promises.push(internalHost.isHostnameTaken(domain_name));
					return true;
				});

				return Promise.all(domain_name_check_promises).then((check_results) => {
					check_results.map((result) => {
						if (result.is_taken) {
							throw new errs.ValidationError(`${result.hostname} is already in use`);
						}
						return true;
					});
				});
			})
			.then(async () => {
				// At this point the domains should have been checked
				thisData.owner_user_id = access.token.getUserId(1);
				thisData = internalHost.cleanSslHstsData(createCertificate, thisData);

				// Fix for db field not having a default value
				// for this optional field.
				if (typeof thisData.advanced_config === "undefined") {
					thisData.advanced_config = "";
				}

				if (typeof thisData.npmplus_location_config === "undefined") {
					thisData.npmplus_location_config = "";
				}
				thisData = internalProxyHostAccessList.cleanAccessListTypes(thisData);
				await internalProxyHostAccessList.validateAccessLists(thisData);
				return proxyHostModel
					.transaction(async (trx) => {
						const row = await proxyHostModel.query(trx).insertAndFetch(thisData);

						const relationRows = internalProxyHostAccessList.getAccessListRelationRows(row.id, thisData);
						if (relationRows.length > 0) {
							await trx("npmplus_proxy_host_access_list").insert(relationRows);
						}

						return row;
					})
					.then(utils.omitRow(omissions()));
			})
			.then((row) => {
				if (createCertificate) {
					return internalCertificate
						.createQuickCertificate(access, thisData)
						.then((cert) => {
							// update host with cert id
							return internalProxyHost.update(access, {
								id: row.id,
								certificate_id: cert.id,
							});
						})
						.then(() => {
							return row;
						});
				}
				return row;
			})
			.then((row) => {
				// re-fetch with cert
				return internalProxyHost.get(access, {
					id: row.id,
					expand: ["certificate", "owner", "access_lists.[clients,items]"],
				});
			})
			.then((row) => {
				const cleanedHost = internalProxyHostAccessList.cleanAccessListTypes(row);
				return internalProxyHostAccessList.populateLocationAccessLists(cleanedHost);
			})
			.then((row) => {
				// Configure nginx
				return internalNginx.configure(proxyHostModel, "proxy_host", row).then(() => {
					return row;
				});
			})
			.then((row) => {
				// Audit log
				thisData.meta = _.assign({}, thisData.meta || {}, row.meta);

				// Add to audit log
				return internalAuditLog
					.add(access, {
						action: "created",
						object_type: "proxy-host",
						object_id: row.id,
						meta: thisData,
					})
					.then(() => {
						return internalProxyHostAccessList.maskAccessListItems(row);
					});
			});
	},

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {Number}  data.id
	 * @return {Promise}
	 */
	update: (access, data) => {
		let thisData = data;
		const createCertificate = thisData.certificate_id === "new";

		if (createCertificate) {
			delete thisData.certificate_id;
		}

		return access
			.can("proxy_hosts:update", thisData.id)
			.then((/*access_data*/) => {
				// Get a list of the domain names and check each of them against existing records
				const domain_name_check_promises = [];

				if (typeof thisData.domain_names !== "undefined") {
					thisData.domain_names.map((domain_name) => {
						return domain_name_check_promises.push(
							internalHost.isHostnameTaken(domain_name, "proxy", thisData.id),
						);
					});

					return Promise.all(domain_name_check_promises).then((check_results) => {
						check_results.map((result) => {
							if (result.is_taken) {
								throw new errs.ValidationError(`${result.hostname} is already in use`);
							}
							return true;
						});
					});
				}
			})
			.then(() => {
				return internalProxyHost.get(access, { id: thisData.id });
			})
			.then((row) => {
				if (row.id !== thisData.id) {
					// Sanity check that something crazy hasn't happened
					throw new errs.InternalValidationError(
						`Proxy Host could not be updated, IDs do not match: ${row.id} !== ${thisData.id}`,
					);
				}

				if (createCertificate) {
					return internalCertificate
						.createQuickCertificate(access, {
							domain_names: thisData.domain_names || row.domain_names,
							meta: _.assign({}, row.meta, thisData.meta),
						})
						.then((cert) => {
							// update host with cert id
							thisData.certificate_id = cert.id;
						})
						.then(() => {
							return row;
						});
				}
				return row;
			})
			.then(async (row) => {
				// Add domain_names to the data in case it isn't there, so that the audit log renders correctly. The order is important here.
				thisData = _.assign(
					{},
					{
						domain_names: row.domain_names,
					},
					data,
				);

				thisData = internalHost.cleanSslHstsData(createCertificate, thisData, row);
				thisData = internalProxyHostAccessList.cleanAccessListTypes(thisData);
				await internalProxyHostAccessList.validateAccessLists(thisData);
				return proxyHostModel
					.transaction(async (trx) => {
						return proxyHostModel
							.query(trx)
							.where({ id: thisData.id })
							.patch(thisData)
							.then((patchResult) => {
								return internalProxyHostAccessList
									.syncAccessListRelations(trx, thisData.id, thisData)
									.then(() => {
										return patchResult;
									});
							});
					})
					.then(() => {
						// Add to audit log
						return internalAuditLog.add(access, {
							action: "updated",
							object_type: "proxy-host",
							object_id: row.id,
							meta: thisData,
						});
					});
			})
			.then(() => {
				return internalProxyHost
					.get(access, {
						id: thisData.id,
						expand: ["owner", "certificate", "access_lists.[clients,items]"],
					})
					.then((row) => {
						const cleanedHost = internalProxyHostAccessList.cleanAccessListTypes(row);
						return internalProxyHostAccessList.populateLocationAccessLists(cleanedHost);
					})
					.then((row) => {
						if (!row.enabled) {
							// No need to add nginx config if host is disabled
							return internalProxyHostAccessList.maskAccessListItems(row);
						}
						// Configure nginx
						return internalNginx.configure(proxyHostModel, "proxy_host", row).then((new_meta) => {
							row.meta = new_meta;
							const cleanedRow = _.omit(internalHost.cleanRowCertificateMeta(row), omissions());
							return internalProxyHostAccessList.maskAccessListItems(cleanedRow);
						});
					});
			});
	},

	/**
	 * @param  {Access}   access
	 * @param  {Object}   data
	 * @param  {Number}   data.id
	 * @param  {Array}    [data.expand]
	 * @param  {Array}    [data.omit]
	 * @return {Promise}
	 */
	get: (access, data) => {
		const thisData = data || {};
		return access
			.can("proxy_hosts:get", thisData.id)
			.then((access_data) => {
				const query = proxyHostModel
					.query()
					.where("is_deleted", 0)
					.andWhere("id", thisData.id)
					.allowGraph(proxyHostModel.defaultAllowGraph)
					.first();

				if (access_data.permission_visibility !== "all") {
					query.andWhere("owner_user_id", access.token.getUserId(1));
				}

				if (typeof thisData.expand !== "undefined" && thisData.expand !== null) {
					query.withGraphFetched(`[${thisData.expand.join(", ")}]`);
				}

				return query.then(utils.omitRow(omissions()));
			})
			.then((row) => {
				if (!row?.id) {
					throw new errs.ItemNotFoundError(thisData.id);
				}

				const aclRow = internalProxyHostAccessList.cleanAccessListTypes(row);

				const thisRow = internalHost.cleanRowCertificateMeta(aclRow);
				// Custom omissions
				if (typeof thisData.omit !== "undefined" && thisData.omit !== null) {
					return _.omit(thisRow, thisData.omit);
				}

				return thisRow;
			});
	},

	/**
	 * @param {Access}  access
	 * @param {Object}  data
	 * @param {Number}  data.id
	 * @param {String}  [data.reason]
	 * @returns {Promise}
	 */
	delete: (access, data) => {
		return access
			.can("proxy_hosts:delete", data.id)
			.then(() => {
				return internalProxyHost.get(access, { id: data.id });
			})
			.then((row) => {
				if (!row?.id) {
					throw new errs.ItemNotFoundError(data.id);
				}

				return proxyHostModel
					.transaction((trx) => {
						return proxyHostModel.query(trx).where("id", row.id).patch({
							is_deleted: 1,
						});
					})
					.then(() => {
						// Delete Nginx Config
						return internalNginx
							.deleteConfig("proxy_host", row)
							.then(() => {
								return internalProxyHostAccessList.delete(row);
							})
							.then(() => {
								return internalNginx.reload();
							});
					})
					.then(() => {
						// Add to audit log
						return internalAuditLog.add(access, {
							action: "deleted",
							object_type: "proxy-host",
							object_id: row.id,
							meta: _.omit(row, omissions()),
						});
					});
			})
			.then(() => {
				return true;
			});
	},

	/**
	 * @param {Access}  access
	 * @param {Object}  data
	 * @param {Number}  data.id
	 * @param {String}  [data.reason]
	 * @returns {Promise}
	 */
	enable: (access, data) => {
		return access
			.can("proxy_hosts:update", data.id)
			.then(() => {
				return internalProxyHost.get(access, {
					id: data.id,
					expand: ["certificate", "owner", "access_lists.[clients,items]"],
				});
			})
			.then((row) => {
				if (!row?.id) {
					throw new errs.ItemNotFoundError(data.id);
				}
				if (row.enabled) {
					throw new errs.ValidationError("Host is already enabled");
				}

				const domainNameCheckPromises = [];
				row.domain_names.map((domain_name) => {
					domainNameCheckPromises.push(internalHost.isHostnameTaken(domain_name));
					return true;
				});
				return Promise.all(domainNameCheckPromises).then((checkResults) => {
					checkResults.map((result) => {
						if (result.is_taken) {
							throw new errs.ValidationError(`${result.hostname} is already in use by an active host`);
						}
						return true;
					});
					return row;
				});
			})
			.then((row) => {
				row.enabled = 1;

				return proxyHostModel
					.query()
					.where("id", row.id)
					.patch({
						enabled: 1,
					})
					.then(() => {
						const cleanedHost = internalProxyHostAccessList.cleanAccessListTypes(row);
						return internalProxyHostAccessList.populateLocationAccessLists(cleanedHost);
					})
					.then((row) => {
						// Configure nginx
						return internalNginx.configure(proxyHostModel, "proxy_host", row);
					})
					.then(() => {
						// Add to audit log
						return internalAuditLog.add(access, {
							action: "enabled",
							object_type: "proxy-host",
							object_id: row.id,
							meta: _.omit(row, omissions()),
						});
					});
			})
			.then(() => {
				return true;
			});
	},

	/**
	 * @param {Access}  access
	 * @param {Object}  data
	 * @param {Number}  data.id
	 * @param {String}  [data.reason]
	 * @returns {Promise}
	 */
	disable: (access, data) => {
		return access
			.can("proxy_hosts:update", data.id)
			.then(() => {
				return internalProxyHost.get(access, { id: data.id });
			})
			.then((row) => {
				if (!row?.id) {
					throw new errs.ItemNotFoundError(data.id);
				}
				if (!row.enabled) {
					throw new errs.ValidationError("Host is already disabled");
				}

				row.enabled = 0;

				return proxyHostModel
					.query()
					.where("id", row.id)
					.patch({
						enabled: 0,
					})
					.then(() => {
						// Delete Nginx Config
						return internalNginx.deleteConfig("proxy_host", row).then(() => {
							return internalNginx.reload();
						});
					})
					.then(() => {
						// Add to audit log
						return internalAuditLog.add(access, {
							action: "disabled",
							object_type: "proxy-host",
							object_id: row.id,
							meta: _.omit(row, omissions()),
						});
					});
			})
			.then(() => {
				return true;
			});
	},

	/**
	 * All Hosts
	 *
	 * @param   {Access}  access
	 * @param   {Array}   [expand]
	 * @param   {String}  [search_query]
	 * @returns {Promise}
	 */
	getAll: async (access, expand, searchQuery) => {
		const accessData = await access.can("proxy_hosts:list");

		const query = proxyHostModel
			.query()
			.where("is_deleted", 0)
			.groupBy("id")
			.allowGraph(proxyHostModel.defaultAllowGraph)
			.orderBy(castJsonIfNeed("domain_names"), "ASC");

		if (accessData.permission_visibility !== "all") {
			query.andWhere("owner_user_id", access.token.getUserId(1));
		}

		// Query is used for searching
		if (typeof searchQuery === "string" && searchQuery.length > 0) {
			query.where(function () {
				this.where(castJsonIfNeed("domain_names"), "like", `%${searchQuery}%`);
			});
		}

		if (typeof expand !== "undefined" && expand !== null) {
			query.withGraphFetched(`[${expand.join(", ")}]`);
		}

		const rows = await query.then(utils.omitRows(omissions()));
		const aclRows = await Promise.all(
			rows.map((row) => {
				return internalProxyHostAccessList.cleanAccessListTypes(row);
			}),
		);

		if (typeof expand !== "undefined" && expand !== null && expand.indexOf("certificate") !== -1) {
			return internalHost.cleanAllRowsCertificateMeta(aclRows);
		}
		return aclRows;
	},

	/**
	 * @param   {Access} access
	 * @param   {Object} data
	 * @param   {Number} data.id
	 * @returns {Promise}
	 */
	getAnalytics: async (access, data) => {
		await access.can("proxy_hosts:analytics", data.id);
		const host = await internalProxyHost.get(access, { id: data.id });
		const hostnames = new Set(host.domain_names || []);
		const retentionMs = Number.isFinite(analyticsRetentionDays)
			? Math.max(analyticsRetentionDays, 1) * 24 * 60 * 60 * 1000
			: 3 * 24 * 60 * 60 * 1000;
		const oldestTimestamp = Date.now() - retentionMs;
		const stats = {
			total_requests: 0,
			total_bytes_sent: 0,
			total_request_time: 0,
			successful_requests: 0,
			last_seen: null,
			statuses: {},
			methods: {},
			paths: {},
		};

		try {
			await fsAccess(accessLogPath);
		} catch {
			return emptyAnalytics();
		}

		const rl = createInterface({
			input: createReadStream(accessLogPath, { encoding: "utf8" }),
			crlfDelay: Number.POSITIVE_INFINITY,
		});

		for await (const line of rl) {
			const entry = parseAccessLogLine(line);
			if (!entry || !hostnames.has(entry.host) || entry.timestamp < oldestTimestamp) {
				continue;
			}

			stats.total_requests += 1;
			stats.total_bytes_sent += entry.bytesSent;
			stats.total_request_time += entry.requestTime;
			if (entry.status < 500) {
				stats.successful_requests += 1;
			}
			if (!stats.last_seen || entry.timestamp > stats.last_seen) {
				stats.last_seen = entry.timestamp;
			}
			stats.statuses[entry.status] = (stats.statuses[entry.status] || 0) + 1;
			stats.methods[entry.method] = (stats.methods[entry.method] || 0) + 1;
			stats.paths[entry.path] = (stats.paths[entry.path] || 0) + 1;
		}

		return normalizeAnalytics(stats);
	},

	clearAnalytics: async (access) => {
		await access.can("settings:update", "analytics");
		const logDir = dirname(accessLogPath);

		try {
			await truncate(accessLogPath, 0);
		} catch {}

		try {
			const files = await readdir(logDir);
			await Promise.all(
				files
					.filter((file) => /^access\.log\.\d+/.test(file))
					.map((file) => rm(join(logDir, file), { force: true })),
			);
		} catch {}

		try {
			await rm("/data/goaccess/data", { recursive: true, force: true });
			await mkdir("/data/goaccess/data", { recursive: true });
		} catch {}

		return true;
	},

	/**
	 * Report use
	 *
	 * @param   {Number}  user_id
	 * @param   {String}  visibility
	 * @returns {Promise}
	 */
	getCount: (user_id, visibility) => {
		const query = proxyHostModel.query().count("id as count").where("is_deleted", 0);

		if (visibility !== "all") {
			query.andWhere("owner_user_id", user_id);
		}

		return query.first().then((row) => {
			return Number.parseInt(row.count, 10);
		});
	},
};

export default internalProxyHost;
