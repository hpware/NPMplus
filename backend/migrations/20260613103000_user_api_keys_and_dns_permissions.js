import { migrate as logger } from "../logger.js";

const migrateName = "user-api-keys-and-dns-permissions";

const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	await knex.schema.alterTable("user_permission", (table) => {
		table.string("dns").notNull().defaultTo("hidden");
	});

	await knex.schema.createTable("user_api_key", (table) => {
		table.increments().primary();
		table.dateTime("created_on").notNull();
		table.dateTime("modified_on").notNull();
		table.integer("user_id").notNull().unsigned();
		table.string("name").notNull();
		table.string("token_prefix", 32).notNull();
		table.string("token_hash", 128).notNull();
		table.json("permissions").notNull();
		table.dateTime("expires_on").nullable();
		table.dateTime("last_used_on").nullable();
		table.integer("is_deleted").notNull().unsigned().defaultTo(0);
		table.unique("token_hash");
		table.index(["user_id", "is_deleted"]);
	});
};

const down = async (knex) => {
	logger.info(`[${migrateName}] Migrating Down...`);

	await knex.schema.dropTable("user_api_key");
	await knex.schema.alterTable("user_permission", (table) => {
		table.dropColumn("dns");
	});
};

export { down, up };
