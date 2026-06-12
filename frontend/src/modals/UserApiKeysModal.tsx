import EasyModal, { type InnerModalProps } from "ez-modal-react";
import { type FormEvent, useState } from "react";
import { Alert, Form, Modal, Table } from "react-bootstrap";
import { Button, Loading } from "src/components";
import { useCreateUserApiKey, useDeleteUserApiKey, useUser, useUserApiKeys } from "src/hooks";

const permissionFields = [
	["proxyHosts", "Proxy hosts"],
	["redirectionHosts", "Redirection hosts"],
	["deadHosts", "404 hosts"],
	["streams", "Streams"],
	["accessLists", "Access lists"],
	["certificates", "Certificates"],
	["dns", "DNS"],
] as const;

const permissionLevels = ["hidden", "view", "manage"];

const showUserApiKeysModal = (id: number) => {
	EasyModal.show(UserApiKeysModal, { id });
};

interface Props extends InnerModalProps {
	id: number;
}

const UserApiKeysModal = EasyModal.create(({ id, visible, remove }: Props) => {
	const { data: user, isLoading: isUserLoading } = useUser(id);
	const { data: keys, isLoading, error } = useUserApiKeys(id);
	const createKey = useCreateUserApiKey(id);
	const deleteKey = useDeleteUserApiKey(id);
	const [name, setName] = useState("");
	const [expiresOn, setExpiresOn] = useState("");
	const [createdToken, setCreatedToken] = useState("");
	const [admin, setAdmin] = useState(false);
	const [visibility, setVisibility] = useState("user");
	const [permissions, setPermissions] = useState<Record<string, string>>({
		proxyHosts: "view",
		redirectionHosts: "hidden",
		deadHosts: "hidden",
		streams: "hidden",
		accessLists: "view",
		certificates: "view",
		dns: "hidden",
	});

	const onSubmit = async (event: FormEvent) => {
		event.preventDefault();
		const result = await createKey.mutateAsync({
			name,
			expiresOn: expiresOn || null,
			permissions: {
				admin,
				visibility,
				...permissions,
			},
		});
		setCreatedToken(result.token || "");
		setName("");
	};

	const setPermission = (field: string, value: string) => {
		setPermissions((current) => ({
			...current,
			[field]: value,
		}));
	};

	return (
		<Modal show={visible} onHide={remove} size="lg">
			<Modal.Header closeButton>
				<Modal.Title>API keys{user?.name ? ` for ${user.name}` : ""}</Modal.Title>
			</Modal.Header>
			<Modal.Body>
				{(isLoading || isUserLoading) && <Loading noLogo />}
				{error && <Alert variant="danger">{error.message}</Alert>}
				{createdToken && (
					<Alert variant="warning">
						<div className="fw-bold mb-2">Copy this token now. It will not be shown again.</div>
						<div className="input-group">
							<input className="form-control font-monospace" readOnly value={createdToken} />
							<Button onClick={() => navigator.clipboard?.writeText(createdToken)}>Copy</Button>
						</div>
					</Alert>
				)}
				<Form onSubmit={onSubmit}>
					<div className="row g-2 mb-3">
						<div className="col-md-6">
							<Form.Label>Name</Form.Label>
							<Form.Control
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="Automation"
								required
							/>
						</div>
						<div className="col-md-6">
							<Form.Label>Expires on</Form.Label>
							<Form.Control
								type="datetime-local"
								value={expiresOn}
								onChange={(event) => setExpiresOn(event.target.value)}
							/>
						</div>
						<div className="col-md-6">
							<Form.Label>Visibility</Form.Label>
							<Form.Select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
								<option value="user">Owned services only</option>
								<option value="all">All visible services</option>
							</Form.Select>
						</div>
						<div className="col-md-6 d-flex align-items-end">
							<Form.Check
								type="switch"
								label="Allow admin API scope"
								checked={admin}
								onChange={(event) => setAdmin(event.target.checked)}
							/>
						</div>
					</div>
					<div className="row g-2 mb-3">
						{permissionFields.map(([field, label]) => (
							<div className="col-md-4" key={field}>
								<Form.Label>{label}</Form.Label>
								<Form.Select
									value={permissions[field]}
									onChange={(event) => setPermission(field, event.target.value)}
								>
									{permissionLevels.map((level) => (
										<option key={level} value={level}>
											{level}
										</option>
									))}
								</Form.Select>
							</div>
						))}
					</div>
					<Button
						className="btn-orange"
						type="submit"
						isLoading={createKey.isPending}
						disabled={createKey.isPending}
					>
						Create API key
					</Button>
				</Form>
				<hr />
				<Table responsive hover className="mb-0">
					<thead>
						<tr>
							<th>Name</th>
							<th>Prefix</th>
							<th>Last used</th>
							<th>Expires</th>
							<th className="text-end">Actions</th>
						</tr>
					</thead>
					<tbody>
						{keys?.map((key) => (
							<tr key={key.id}>
								<td>{key.name}</td>
								<td className="font-monospace">{key.tokenPrefix}...</td>
								<td>{key.lastUsedOn || "Never"}</td>
								<td>{key.expiresOn || "Never"}</td>
								<td className="text-end">
									<Button
										size="sm"
										className="btn-outline-danger"
										onClick={() => deleteKey.mutate(key.id)}
										disabled={deleteKey.isPending}
									>
										Revoke
									</Button>
								</td>
							</tr>
						))}
						{!keys?.length && !isLoading && (
							<tr>
								<td colSpan={5} className="text-muted">
									No API keys
								</td>
							</tr>
						)}
					</tbody>
				</Table>
			</Modal.Body>
			<Modal.Footer>
				<Button onClick={remove}>Close</Button>
			</Modal.Footer>
		</Modal>
	);
});

export { showUserApiKeysModal };
