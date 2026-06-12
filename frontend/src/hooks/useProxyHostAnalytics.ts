import { useQuery } from "@tanstack/react-query";
import { getProxyHostAnalytics, type ProxyHostAnalytics } from "src/api/backend";

const useProxyHostAnalytics = (id: number, options = {}) => {
	return useQuery<ProxyHostAnalytics, Error>({
		queryKey: ["proxy-host-analytics", id],
		queryFn: () => getProxyHostAnalytics(id),
		staleTime: 30 * 1000,
		...options,
	});
};

export { useProxyHostAnalytics };
