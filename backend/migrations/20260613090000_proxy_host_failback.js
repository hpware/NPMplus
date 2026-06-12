import { migrate as logger } from "../logger.js";

const migrateName = "proxy-host-failback";

const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	await knex.schema.alterTable("proxy_host", (table) => {
		table.integer("failback_enabled").notNull().unsigned().defaultTo(0);
		table.string("failback_host").notNull().defaultTo("");
		table.integer("failback_port").nullable().unsigned();
	});
};

const down = async (knex) => {
	logger.info(`[${migrateName}] Migrating Down...`);

	await knex.schema.alterTable("proxy_host", (table) => {
		table.dropColumn("failback_enabled");
		table.dropColumn("failback_host");
		table.dropColumn("failback_port");
	});
};

export { down, up };
