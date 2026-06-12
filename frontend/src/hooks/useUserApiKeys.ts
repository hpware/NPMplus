import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createUserApiKey,
	deleteUserApiKey,
	getUserApiKeys,
	type UserApiKey,
	type UserApiKeyCreate,
} from "src/api/backend";

const useUserApiKeys = (userId: number | string) => {
	return useQuery<UserApiKey[], Error>({
		queryKey: ["user-api-keys", userId],
		queryFn: () => getUserApiKeys(userId),
	});
};

const useCreateUserApiKey = (userId: number | string) => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (values: UserApiKeyCreate) => createUserApiKey(userId, values),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["user-api-keys", userId] });
			queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
		},
	});
};

const useDeleteUserApiKey = (userId: number | string) => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (keyId: number) => deleteUserApiKey(userId, keyId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["user-api-keys", userId] });
			queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
		},
	});
};

export { useCreateUserApiKey, useDeleteUserApiKey, useUserApiKeys };
