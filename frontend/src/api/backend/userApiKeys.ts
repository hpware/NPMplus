import * as api from "./base";
import type { UserApiKey, UserApiKeyCreate } from "./models";

export async function getUserApiKeys(userId: number | string): Promise<UserApiKey[]> {
	return await api.get({
		url: `/users/${userId}/api-keys`,
	});
}

export async function createUserApiKey(userId: number | string, data: UserApiKeyCreate): Promise<UserApiKey> {
	return await api.post({
		url: `/users/${userId}/api-keys`,
		data,
	});
}

export async function deleteUserApiKey(userId: number | string, keyId: number): Promise<boolean> {
	return await api.del({
		url: `/users/${userId}/api-keys/${keyId}`,
	});
}
