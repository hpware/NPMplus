import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert } from "react-bootstrap";
import { clearProxyHostAnalytics } from "src/api/backend";
import { Button, Loading } from "src/components";
import { useHealth } from "src/hooks";
import { showSuccess } from "src/notifications";

export default function Analytics() {
	const queryClient = useQueryClient();
	const { data, isLoading, error } = useHealth();
	const [isClearing, setIsClearing] = useState(false);
	const [errorMsg, setErrorMsg] = useState("");

	if (isLoading) {
		return (
			<div className="card-body">
				<Loading noLogo />
			</div>
		);
	}

	return (
		<div className="card-body">
			{error && <Alert variant="danger">{error.message}</Alert>}
			{errorMsg && (
				<Alert variant="danger" onClose={() => setErrorMsg("")} dismissible>
					{errorMsg}
				</Alert>
			)}
			<h3>Analytics</h3>
			<p className="text-secondary">
				Embedded analytics are calculated from recent Nginx access logs. Current retention window:{" "}
				<strong>{data?.analyticsRetentionDays || 3} days</strong>.
			</p>
			<div className="btn-list">
				<Button
					actionType="danger"
					isLoading={isClearing}
					disabled={isClearing}
					onClick={async () => {
						setIsClearing(true);
						setErrorMsg("");
						try {
							await clearProxyHostAnalytics();
							queryClient.invalidateQueries({ queryKey: ["proxy-host-analytics"] });
							showSuccess("Analytics cleared");
						} catch (err) {
							setErrorMsg(err instanceof Error ? err.message : "Failed to clear analytics");
						}
						setIsClearing(false);
					}}
				>
					Clear all analytics
				</Button>
			</div>
		</div>
	);
}
