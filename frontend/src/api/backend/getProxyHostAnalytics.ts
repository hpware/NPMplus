import * as api from "./base";
import type { ProxyHostAnalytics } from "./models";

export async function getProxyHostAnalytics(id: number): Promise<ProxyHostAnalytics> {
	return await api.get({
		url: `/nginx/proxy-hosts/${id}/analytics`,
	});
}

export async function clearProxyHostAnalytics(): Promise<boolean> {
	return await api.del({
		url: "/nginx/proxy-hosts/analytics",
	});
}
