import EasyModal, { type InnerModalProps } from "ez-modal-react";
import Alert from "react-bootstrap/Alert";
import Modal from "react-bootstrap/Modal";
import { clearProxyHostAnalytics } from "src/api/backend";
import { Button, HasPermission, Loading } from "src/components";
import { useProxyHostAnalytics } from "src/hooks";
import { ADMIN, MANAGE } from "src/modules/Permissions";

interface Props extends InnerModalProps {
	id: number;
}

const formatBytes = (bytes: number) => {
	if (!bytes) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

const ProxyHostAnalyticsModal = EasyModal.create(({ id, visible, remove }: Props) => {
	const { data, isLoading, error, refetch } = useProxyHostAnalytics(id);
	const statuses = Object.entries(data?.statuses || {}).sort(([a], [b]) => a.localeCompare(b));
	const methods = Object.entries(data?.methods || {}).sort(([a], [b]) => a.localeCompare(b));

	return (
		<Modal show={visible} onHide={remove} size="lg">
			<Modal.Header closeButton>
				<Modal.Title>Analytics</Modal.Title>
			</Modal.Header>
			<Modal.Body>
				{error && <Alert variant="danger">{error.message}</Alert>}
				{isLoading && <Loading noLogo />}
				{data && (
					<>
						<div className="row row-cards mb-3">
							<div className="col-md-4">
								<div className="card">
									<div className="card-body">
										<div className="text-muted">Requests</div>
										<div className="h2 mb-0">{data.totalRequests.toLocaleString()}</div>
									</div>
								</div>
							</div>
							<div className="col-md-4">
								<div className="card">
									<div className="card-body">
										<div className="text-muted">Bytes sent</div>
										<div className="h2 mb-0">{formatBytes(data.totalBytesSent)}</div>
									</div>
								</div>
							</div>
							<div className="col-md-4">
								<div className="card">
									<div className="card-body">
										<div className="text-muted">Uptime</div>
										<div className="h2 mb-0">{data.uptimePercent}%</div>
									</div>
								</div>
							</div>
						</div>
						<div className="row row-cards mb-3">
							<div className="col-md-6">
								<div className="card">
									<div className="card-body">
										<div className="text-muted">Average time</div>
										<div className="h3 mb-0">{data.averageRequestTime}s</div>
									</div>
								</div>
							</div>
							<div className="col-md-6">
								<div className="card">
									<div className="card-body">
										<div className="text-muted">Last request</div>
										<div className="h3 mb-0">
											{data.lastSeen ? new Date(data.lastSeen).toLocaleString() : "No data"}
										</div>
									</div>
								</div>
							</div>
						</div>
						<div className="row">
							<div className="col-md-6">
								<h3>Status codes</h3>
								<table className="table table-sm">
									<tbody>
										{statuses.map(([status, count]) => (
											<tr key={status}>
												<td>{status}</td>
												<td className="text-end">{count.toLocaleString()}</td>
											</tr>
										))}
										{statuses.length === 0 && (
											<tr>
												<td className="text-muted">No requests found</td>
											</tr>
										)}
									</tbody>
								</table>
							</div>
							<div className="col-md-6">
								<h3>Methods</h3>
								<table className="table table-sm">
									<tbody>
										{methods.map(([method, count]) => (
											<tr key={method}>
												<td>{method}</td>
												<td className="text-end">{count.toLocaleString()}</td>
											</tr>
										))}
										{methods.length === 0 && (
											<tr>
												<td className="text-muted">No requests found</td>
											</tr>
										)}
									</tbody>
								</table>
							</div>
						</div>
						<h3>Top paths</h3>
						<table className="table table-sm">
							<tbody>
								{data.topPaths.map((item) => (
									<tr key={item.path}>
										<td className="text-break">{item.path}</td>
										<td className="text-end">{item.requests.toLocaleString()}</td>
									</tr>
								))}
								{data.topPaths.length === 0 && (
									<tr>
										<td className="text-muted">No requests found</td>
									</tr>
								)}
							</tbody>
						</table>
					</>
				)}
			</Modal.Body>
			<Modal.Footer>
				<HasPermission section={ADMIN} permission={MANAGE} hideError>
					<Button
						actionType="danger"
						onClick={async () => {
							await clearProxyHostAnalytics();
							await refetch();
						}}
					>
						Clear analytics
					</Button>
				</HasPermission>
				<Button onClick={remove}>Close</Button>
			</Modal.Footer>
		</Modal>
	);
});

const showProxyHostAnalyticsModal = (id: number) => {
	EasyModal.show(ProxyHostAnalyticsModal, { id } as Omit<Props, "visible" | "remove">);
};

export { showProxyHostAnalyticsModal };
