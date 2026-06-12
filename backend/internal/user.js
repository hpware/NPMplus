import crypto from "node:crypto";
import { writeFile } from "node:fs/promises";
import _ from "lodash";
import errs from "../lib/error.js";
import utils from "../lib/utils.js";
import { gravatar as logger } from "../logger.js";
import authModel from "../models/auth.js";
import userModel from "../models/user.js";
import userApiKeyModel from "../models/user_api_key.js";
import userPermissionModel from "../models/user_permission.js";
import pjson from "../package.json" with { type: "json" };
import internalAuditLog from "./audit-log.js";
import internalToken from "./token.js";

const omissions = () => {
	return ["is_deleted", "permissions.id", "permissions.user_id", "permissions.created_on", "permissions.modified_on"];
};

const permissionOrDefault = (value, fallback) => {
	return ["hidden", "view", "manage"].includes(value) ? value : fallback;
};

const clampPermission = (requested, allowed) => {
	const rank = { hidden: 0, view: 1, manage: 2 };
	const requestedValue = permissionOrDefault(requested, "hidden");
	const allowedValue = permissionOrDefault(allowed, "hidden");
	return rank[requestedValue] <= rank[allowedValue] ? requestedValue : allowedValue;
};

const visibilityOrDefault = (value) => {
	return ["user", "all"].includes(value) ? value : "user";
};

const splitEnvList = (value) => {
	return (value || "")
		.split(",")
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);
};

const oidcDefaultPermissions = () => ({
	visibility: visibilityOrDefault(process.env.OIDC_DEFAULT_VISIBILITY),
	proxy_hosts: permissionOrDefault(process.env.OIDC_DEFAULT_PROXY_HOSTS, "view"),
	redirection_hosts: permissionOrDefault(process.env.OIDC_DEFAULT_REDIRECTION_HOSTS, "hidden"),
	dead_hosts: permissionOrDefault(process.env.OIDC_DEFAULT_DEAD_HOSTS, "hidden"),
	streams: permissionOrDefault(process.env.OIDC_DEFAULT_STREAMS, "hidden"),
	access_lists: permissionOrDefault(process.env.OIDC_DEFAULT_ACCESS_LISTS, "view"),
	certificates: permissionOrDefault(process.env.OIDC_DEFAULT_CERTIFICATES, "view"),
	dns: permissionOrDefault(process.env.OIDC_DEFAULT_DNS, "hidden"),
});

const isOidcAdminEmail = (email) => splitEnvList(process.env.OIDC_AUTO_CREATE_ADMIN_EMAILS).includes(email);

const apiKeyOmissions = () => ["token_hash"];

const hashApiKeyToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const normalizeApiKeyPermissions = (requested, userPermissions) => ({
	admin: requested?.admin === true,
	visibility: requested?.visibility === "all" && userPermissions?.visibility === "all" ? "all" : "user",
	proxy_hosts: clampPermission(requested?.proxy_hosts, userPermissions?.proxy_hosts),
	redirection_hosts: clampPermission(requested?.redirection_hosts, userPermissions?.redirection_hosts),
	dead_hosts: clampPermission(requested?.dead_hosts, userPermissions?.dead_hosts),
	streams: clampPermission(requested?.streams, userPermissions?.streams),
	access_lists: clampPermission(requested?.access_lists, userPermissions?.access_lists),
	certificates: clampPermission(requested?.certificates, userPermissions?.certificates),
	dns: clampPermission(requested?.dns, userPermissions?.dns),
});

const internalUser = {
	/**
	 * Create a user can happen unauthenticated only once and only when no active users exist.
	 * Otherwise, a valid auth method is required.
	 *
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @returns {Promise}
	 */
	create: async (access, data) => {
		const auth = data.auth || null;
		delete data.auth;

		data.avatar = data.avatar || "";
		data.roles = data.roles || [];

		data.email = data.email.toLowerCase().trim();
		internalUser.isEmailAvailable(data.email).then((available) => {
			if (!available) {
				throw new errs.ValidationError(`Email address already in use - ${data.email}`);
			}
		});

		if (typeof data.is_disabled !== "undefined") {
			data.is_disabled = data.is_disabled ? 1 : 0;
		}

		await access.can("users:create", data);

		if (process.env.DISABLE_GRAVATAR === "true") {
			data.avatar = "/images/default-avatar.jpg";
		} else {
			try {
				const hash = crypto.createHash("sha256").update(data.email.trim().toLowerCase()).digest("hex");
				const response = await fetch(
					`https://www.gravatar.com/avatar/${hash}?s=64&default=initials&name=${encodeURIComponent(
						data.name
							.split(" ")
							.map((n) => n[0])
							.join(""),
					)}`,
					{
						headers: {
							"User-Agent": `NPMplus/${pjson.version}`,
						},
					},
				);

				if (!response.ok) throw new Error(`Status code: ${response.status}`);

				let ext;
				switch (response.headers.get("content-type")) {
					case "image/png":
						ext = "png";
						break;
					case "image/jpeg":
						ext = "jpeg";
						break;
					case "image/gif":
						ext = "gif";
						break;
					default:
						throw new Error();
				}

				const buffer = await response.arrayBuffer();
				await writeFile(`/data/npmplus/gravatar/${hash}.${ext}`, Buffer.from(buffer));

				data.avatar = `/images/gravatar/${hash}.${ext}`;
			} catch (err) {
				logger.error(`Error downloading gravatar: ${err.message}`);
				data.avatar = "/images/default-avatar.jpg";
			}
		}

		let user = await userModel.query().insertAndFetch(data).then(utils.omitRow(omissions()));
		if (auth) {
			user = await authModel.query().insert({
				user_id: user.id,
				type: auth.type,
				secret: auth.secret,
				meta: {},
			});
		}

		// Create permissions row as well
		const isAdmin = data.roles.indexOf("admin") !== -1;

		await userPermissionModel.query().insert({
			user_id: user.id,
			visibility: isAdmin ? "all" : "user",
			proxy_hosts: "manage",
			redirection_hosts: "manage",
			dead_hosts: "manage",
			streams: "manage",
			access_lists: "manage",
			certificates: "manage",
			dns: "manage",
		});

		user = await internalUser.get(access, { id: user.id, expand: ["permissions"] });

		await internalAuditLog.add(access, {
			action: "created",
			object_type: "user",
			object_id: user.id,
			meta: user,
		});

		return user;
	},

	/**
	 * Create or return a local user for a trusted OIDC identity.
	 *
	 * @param   {Object} data
	 * @param   {String} data.email
	 * @param   {String} [data.name]
	 * @returns {Promise}
	 */
	ensureFromOidcClaim: async (data) => {
		const email = data.email.toLowerCase().trim();
		const existing = await userModel
			.query()
			.where("email", email)
			.andWhere("is_deleted", 0)
			.andWhere("is_disabled", 0)
			.first();

		if (existing) {
			return existing;
		}

		if (process.env.OIDC_AUTO_CREATE_USERS !== "true") {
			throw new errs.AuthError("OIDC user is not allowed. Ask an administrator to create this user first.");
		}

		const name = (data.name || email.split("@").shift() || email).trim();
		const isAdmin = isOidcAdminEmail(email);
		const user = await userModel.query().insertAndFetch({
			email,
			name,
			nickname: name,
			avatar: "/images/default-avatar.jpg",
			roles: isAdmin ? ["admin"] : [],
		});

		await userPermissionModel.query().insert({
			user_id: user.id,
			...(isAdmin
				? {
						visibility: "all",
						proxy_hosts: "manage",
						redirection_hosts: "manage",
						dead_hosts: "manage",
						streams: "manage",
						access_lists: "manage",
						certificates: "manage",
						dns: "manage",
					}
				: oidcDefaultPermissions()),
		});

		return user;
	},

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {Integer} data.id
	 * @param  {String}  [data.email]
	 * @param  {String}  [data.name]
	 * @return {Promise}
	 */
	update: (access, data) => {
		if (typeof data.is_disabled !== "undefined") {
			data.is_disabled = data.is_disabled ? 1 : 0;
		}

		return access
			.can("users:permissions", data.id)
			.catch(() => {
				delete data.roles;
			})
			.then(() => {
				return access.can("users:update", data.id);
			})
			.then(() => {
				// Make sure that the user being updated doesn't change their email to another user that is already using it
				// 1. get user we want to update
				return internalUser.get(access, { id: data.id }).then((user) => {
					// 2. if email is to be changed, find other users with that email
					if (typeof data.email !== "undefined") {
						data.email = data.email.toLowerCase().trim();

						if (user.email !== data.email) {
							return internalUser.isEmailAvailable(data.email, data.id).then((available) => {
								if (!available) {
									throw new errs.ValidationError(`Email address already in use - ${data.email}`);
								}
								return user;
							});
						}
					}

					// No change to email:
					return user;
				});
			})
			.then(async (user) => {
				if (user.id !== data.id) {
					// Sanity check that something crazy hasn't happened
					throw new errs.InternalValidationError(
						`User could not be updated, IDs do not match: ${user.id} !== ${data.id}`,
					);
				}

				if (process.env.DISABLE_GRAVATAR === "true") {
					data.avatar = "/images/default-avatar.jpg";
				} else {
					try {
						const hash = crypto
							.createHash("sha256")
							.update((data.email || user.email).trim().toLowerCase())
							.digest("hex");
						const response = await fetch(
							`https://www.gravatar.com/avatar/${hash}?s=64&default=initials&name=${encodeURIComponent(
								(data.name || user.name)
									.split(" ")
									.map((n) => n[0])
									.join(""),
							)}`,
							{
								headers: {
									"User-Agent": `NPMplus/${pjson.version}`,
								},
							},
						);

						if (!response.ok) throw new Error(`Status code: ${response.status}`);

						let ext;
						switch (response.headers.get("content-type")) {
							case "image/png":
								ext = "png";
								break;
							case "image/jpeg":
								ext = "jpg";
								break;
							case "image/gif":
								ext = "gif";
								break;
							default:
								throw new Error();
						}

						const buffer = await response.arrayBuffer();
						await writeFile(`/data/npmplus/gravatar/${hash}.${ext}`, Buffer.from(buffer));

						data.avatar = `/images/gravatar/${hash}.${ext}`;
					} catch (err) {
						logger.error(`Error downloading gravatar: ${err.message}`);
						data.avatar = "/images/default-avatar.jpg";
					}
				}

				return userModel.query().patchAndFetchById(user.id, data).then(utils.omitRow(omissions()));
			})
			.then(() => {
				return internalUser.get(access, { id: data.id });
			})
			.then((user) => {
				// Add to audit log
				return internalAuditLog
					.add(access, {
						action: "updated",
						object_type: "user",
						object_id: user.id,
						meta: { ...data, id: user.id, name: user.name },
					})
					.then(() => {
						return user;
					});
			});
	},

	/**
	 * @param  {Access}   access
	 * @param  {Object}   [data]
	 * @param  {Integer}  [data.id]          Defaults to the token user
	 * @param  {Array}    [data.expand]
	 * @param  {Array}    [data.omit]
	 * @return {Promise}
	 */
	get: (access, data) => {
		const thisData = data || {};

		if (typeof thisData.id === "undefined" || !thisData.id) {
			thisData.id = access.token.getUserId(0);
		}

		return access
			.can("users:get", thisData.id)
			.then(() => {
				const query = userModel
					.query()
					.where("is_deleted", 0)
					.andWhere("id", thisData.id)
					.allowGraph("[permissions]")
					.first();

				if (typeof thisData.expand !== "undefined" && thisData.expand !== null) {
					query.withGraphFetched(`[${thisData.expand.join(", ")}]`);
				}

				return query.then(utils.omitRow(omissions()));
			})
			.then((row) => {
				if (!row?.id) {
					throw new errs.ItemNotFoundError(thisData.id);
				}
				// Custom omissions
				if (typeof thisData.omit !== "undefined" && thisData.omit !== null) {
					return _.omit(row, thisData.omit);
				}

				if (row.avatar === "") {
					row.avatar = "/images/default-avatar.jpg";
				}

				return row;
			});
	},

	/**
	 * Checks if an email address is available, but if a user_id is supplied, it will ignore checking
	 * against that user.
	 *
	 * @param email
	 * @param user_id
	 */
	isEmailAvailable: (email, user_id) => {
		const query = userModel.query().where("email", "=", email.toLowerCase().trim()).where("is_deleted", 0).first();

		if (typeof user_id !== "undefined") {
			query.where("id", "!=", user_id);
		}

		return query.then((user) => {
			return !user;
		});
	},

	/**
	 * @param {Access}  access
	 * @param {Object}  data
	 * @param {Integer} data.id
	 * @param {String}  [data.reason]
	 * @returns {Promise}
	 */
	delete: (access, data) => {
		return access
			.can("users:delete", data.id)
			.then(() => {
				return internalUser.get(access, { id: data.id });
			})
			.then((user) => {
				if (!user) {
					throw new errs.ItemNotFoundError(data.id);
				}

				// Make sure user can't delete themselves
				if (user.id === access.token.getUserId(0)) {
					throw new errs.PermissionError("You cannot delete yourself.");
				}

				return userModel
					.query()
					.where("id", user.id)
					.patch({
						is_deleted: 1,
					})
					.then(() => {
						// Add to audit log
						return internalAuditLog.add(access, {
							action: "deleted",
							object_type: "user",
							object_id: user.id,
							meta: _.omit(user, omissions()),
						});
					});
			})
			.then(() => {
				return true;
			});
	},

	/**
	 * This will only count the users
	 *
	 * @param   {Access}  access
	 * @param   {String}  [search_query]
	 * @returns {*}
	 */
	getCount: (access, search_query) => {
		return access
			.can("users:list")
			.then(() => {
				const query = userModel.query().count("id as count").where("is_deleted", 0).first();

				// Query is used for searching
				if (typeof search_query === "string") {
					query.where(function () {
						this.where("user.name", "like", `%${search_query}%`).orWhere(
							"user.email",
							"like",
							`%${search_query}%`,
						);
					});
				}

				return query;
			})
			.then((row) => {
				return Number.parseInt(row.count, 10);
			});
	},

	/**
	 * All users
	 *
	 * @param   {Access}  access
	 * @param   {Array}   [expand]
	 * @param   {String}  [search_query]
	 * @returns {Promise}
	 */
	getAll: async (access, expand, search_query) => {
		await access.can("users:list");
		const query = userModel
			.query()
			.where("is_deleted", 0)
			.groupBy("id")
			.allowGraph("[permissions]")
			.orderBy("name", "ASC");

		// Query is used for searching
		if (typeof search_query === "string") {
			query.where(function () {
				this.where("name", "like", `%${search_query}%`).orWhere("email", "like", `%${search_query}%`);
			});
		}

		if (typeof expand !== "undefined" && expand !== null) {
			query.withGraphFetched(`[${expand.join(", ")}]`);
		}

		const res = await query;
		return utils.omitRows(omissions())(res);
	},

	/**
	 * @param   {Access} access
	 * @param   {Integer} [id_requested]
	 * @returns {[String]}
	 */
	getUserOmisionsByAccess: (access, idRequested) => {
		let response = []; // Admin response

		if (!access.token.hasScope("admin") && access.token.getUserId(0) !== idRequested) {
			response = ["is_deleted"]; // Restricted response
		}

		return response;
	},

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {Integer} data.id
	 * @param  {String}  data.type
	 * @param  {String}  data.secret
	 * @return {Promise}
	 */
	setPassword: (access, data) => {
		return access
			.can("users:password", data.id)
			.then(() => {
				return internalUser.get(access, { id: data.id });
			})
			.then((user) => {
				if (user.id !== data.id) {
					// Sanity check that something crazy hasn't happened
					throw new errs.InternalValidationError(
						`User could not be updated, IDs do not match: ${user.id} !== ${data.id}`,
					);
				}

				if (user.id === access.token.getUserId(0)) {
					// they're setting their own password. Make sure their current password is correct
					if (typeof data.current === "undefined" || !data.current) {
						throw new errs.ValidationError("Current password was not supplied");
					}

					return internalToken
						.getTokenFromEmail({
							identity: user.email.toLowerCase().trim(),
							secret: data.current,
						})
						.then(() => {
							return user;
						});
				}

				return user;
			})
			.then((user) => {
				// Get auth, patch if it exists
				return authModel
					.query()
					.where("user_id", user.id)
					.andWhere("type", data.type)
					.first()
					.then((existing_auth) => {
						if (existing_auth) {
							// patch
							return authModel.query().where("user_id", user.id).andWhere("type", data.type).patch({
								type: data.type, // This is required for the model to encrypt on save
								secret: data.secret,
							});
						}
						// insert
						return authModel.query().insert({
							user_id: user.id,
							type: data.type,
							secret: data.secret,
							meta: {},
						});
					})
					.then(() => {
						// Add to Audit Log
						return internalAuditLog.add(access, {
							action: "updated",
							object_type: "user",
							object_id: user.id,
							meta: {
								name: user.name,
								password_changed: true,
								auth_type: data.type,
							},
						});
					});
			})
			.then(() => {
				return true;
			});
	},

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @return {Promise}
	 */
	setPermissions: (access, data) => {
		return access
			.can("users:permissions", data.id)
			.then(() => {
				return internalUser.get(access, { id: data.id });
			})
			.then((user) => {
				if (user.id !== data.id) {
					// Sanity check that something crazy hasn't happened
					throw new errs.InternalValidationError(
						`User could not be updated, IDs do not match: ${user.id} !== ${data.id}`,
					);
				}

				return user;
			})
			.then((user) => {
				// Get perms row, patch if it exists
				return userPermissionModel
					.query()
					.where("user_id", user.id)
					.first()
					.then((existing_auth) => {
						if (existing_auth) {
							// patch
							return userPermissionModel
								.query()
								.where("user_id", user.id)
								.patchAndFetchById(existing_auth.id, _.assign({ user_id: user.id }, data));
						}
						// insert
						return userPermissionModel.query().insertAndFetch(_.assign({ user_id: user.id }, data));
					})
					.then((permissions) => {
						// Add to Audit Log
						return internalAuditLog.add(access, {
							action: "updated",
							object_type: "user",
							object_id: user.id,
							meta: {
								name: user.name,
								permissions: permissions,
							},
						});
					});
			})
			.then(() => {
				return true;
			});
	},

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {Integer} data.id
	 * @return {Promise}
	 */
	getApiKeys: async (access, data) => {
		await access.can("users:api_keys", data.id);
		const rows = await userApiKeyModel
			.query()
			.where("user_id", data.id)
			.andWhere("is_deleted", 0)
			.orderBy("created_on", "DESC");
		return utils.omitRows(apiKeyOmissions())(rows);
	},

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {Integer} data.id
	 * @param  {String}  data.name
	 * @param  {Object}  data.permissions
	 * @param  {String}  [data.expires_on]
	 * @return {Promise}
	 */
	createApiKey: async (access, data) => {
		await access.can("users:api_keys", data.id);
		const user = await internalUser.get(access, { id: data.id, expand: ["permissions"] });
		const token = `npmplus_${crypto.randomBytes(32).toString("base64url")}`;
		const permissions = normalizeApiKeyPermissions(data.permissions || {}, user.permissions || {});
		const row = await userApiKeyModel.query().insertAndFetch({
			user_id: data.id,
			name: data.name.trim(),
			token_prefix: token.slice(0, 16),
			token_hash: hashApiKeyToken(token),
			permissions,
			expires_on: data.expires_on || null,
		});

		await internalAuditLog.add(access, {
			action: "created",
			object_type: "user_api_key",
			object_id: row.id,
			meta: {
				user_id: data.id,
				name: row.name,
				token_prefix: row.token_prefix,
				permissions,
			},
		});

		return {
			..._.omit(row, apiKeyOmissions()),
			token,
		};
	},

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {Integer} data.id
	 * @param  {Integer} data.key_id
	 * @return {Promise}
	 */
	deleteApiKey: async (access, data) => {
		await access.can("users:api_keys", data.id);
		const row = await userApiKeyModel
			.query()
			.where("id", data.key_id)
			.andWhere("user_id", data.id)
			.andWhere("is_deleted", 0)
			.first();

		if (!row) {
			throw new errs.ItemNotFoundError(data.key_id);
		}

		await userApiKeyModel.query().patchAndFetchById(row.id, { is_deleted: 1 });
		await internalAuditLog.add(access, {
			action: "deleted",
			object_type: "user_api_key",
			object_id: row.id,
			meta: {
				user_id: data.id,
				name: row.name,
				token_prefix: row.token_prefix,
			},
		});
		return true;
	},

	/**
	 * @param {Access}   access
	 * @param {Object}   data
	 * @param {Integer}  data.id
	 */
	loginAs: (access, data) => {
		return access
			.can("users:loginas", data.id)
			.then(() => {
				return internalUser.get(access, data);
			})
			.then((user) => {
				return internalToken.getTokenFromUser(user);
			});
	},
};

export default internalUser;
