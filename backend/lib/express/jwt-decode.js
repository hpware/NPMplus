import crypto from "node:crypto";
import userApiKeyModel from "../../models/user_api_key.js";
import Access from "../access.js";
import errs from "../error.js";

const hashApiKeyToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const getApiKeyContext = async (req) => {
	const authHeader = req.get("authorization") || "";
	const match = authHeader.match(/^Bearer\s+(.+)$/i);
	const token = match?.[1]?.trim();

	if (!token?.startsWith("npmplus_")) {
		return null;
	}

	const apiKey = await userApiKeyModel
		.query()
		.where("token_hash", hashApiKeyToken(token))
		.andWhere("is_deleted", 0)
		.first();

	if (!apiKey) {
		throw new errs.AuthError("Invalid API key");
	}

	if (apiKey.expires_on && new Date(apiKey.expires_on).getTime() <= Date.now()) {
		throw new errs.AuthError("Expired API key");
	}

	await userApiKeyModel.query().patchAndFetchById(apiKey.id, {
		last_used_on: new Date().toISOString(),
	});

	return {
		user_id: apiKey.user_id,
		permissions: apiKey.permissions || {},
	};
};

export default () => {
	return async (req, res, next) => {
		const token = req.signedCookies?.["__Host-Http-token"] || null;

		//if (!token) {
		//	return res.status(401).json({
		//		error: {
		//			message: "Missing token",
		//		},
		//	});
		//}

		try {
			res.locals.access = null;
			const apiKeyContext = await getApiKeyContext(req);
			const access = new Access(apiKeyContext ? null : token, apiKeyContext);
			await access.load();
			res.locals.access = access;
			next();
		} catch {
			res.clearCookie("__Host-Http-token", {
				httpOnly: true,
				secure: true,
				sameSite: "Strict",
			});
			return res.status(403).json({
				error: {
					message: "Invalid or expired token",
				},
			});
		}
	};
};
