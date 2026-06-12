import { type ReactNode, useEffect, useState } from "react";
import { Alert, Form } from "react-bootstrap";
import { Button, Loading } from "src/components";
import { useSetSetting, useSetting } from "src/hooks";
import { showObjectSuccess } from "src/notifications";

export default function SecurityPolicy() {
	const { data, isLoading, error } = useSetting("security-policy");
	const { mutate: setSetting } = useSetSetting();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const meta = data?.meta || {};
	const [defaultWafEnabled, setDefaultWafEnabled] = useState(meta.defaultWafEnabled === true);
	const [blockedHostnames, setBlockedHostnames] = useState(meta.blockedHostnames || "");
	const [blockedPorts, setBlockedPorts] = useState(meta.blockedPorts || "");
	const [countryAccessMode, setCountryAccessMode] = useState(meta.countryAccessMode || "disabled");
	const [countryAccessCodes, setCountryAccessCodes] = useState(meta.countryAccessCodes || "");
	const [credentialUsername, setCredentialUsername] = useState(meta.credentialUsername || "");
	const [credentialPassword, setCredentialPassword] = useState(meta.credentialPassword || "");
	const [openappsecAgentToken, setOpenappsecAgentToken] = useState(meta.openappsecAgentToken || "");

	useEffect(() => {
		if (!data?.meta) return;
		setDefaultWafEnabled(data.meta.defaultWafEnabled === true);
		setBlockedHostnames(data.meta.blockedHostnames || "");
		setBlockedPorts(data.meta.blockedPorts || "");
		setCountryAccessMode(data.meta.countryAccessMode || "disabled");
		setCountryAccessCodes(data.meta.countryAccessCodes || "");
		setCredentialUsername(data.meta.credentialUsername || "");
		setCredentialPassword(data.meta.credentialPassword || "");
		setOpenappsecAgentToken(data.meta.openappsecAgentToken || "");
	}, [data]);

	if (!isLoading && error) {
		return (
			<div className="card-body">
				<Alert variant="danger" show>
					{error.message}
				</Alert>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="card-body">
				<Loading noLogo />
			</div>
		);
	}

	const onSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);
		setSetting(
			{
				id: "security-policy",
				value: "enabled",
				meta: {
					defaultWafEnabled,
					blockedHostnames,
					blockedPorts,
					countryAccessMode,
					countryAccessCodes: countryAccessCodes.toUpperCase(),
					credentialUsername,
					credentialPassword,
					openappsecAgentToken,
				},
			},
			{
				onError: (err: any) => setErrorMsg(err.message),
				onSuccess: () => showObjectSuccess("setting", "saved"),
				onSettled: () => setIsSubmitting(false),
			},
		);
	};

	return (
		<Form onSubmit={onSubmit}>
			<div className="card-body">
				<h3 className="card-title">Security policy</h3>
				<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
					{errorMsg}
				</Alert>
				<div className="row g-3">
					<div className="col-md-6">
						<Form.Check
							type="switch"
							label="Enable WAF/appsec by default for proxy hosts"
							checked={defaultWafEnabled}
							onChange={(event) => setDefaultWafEnabled(event.target.checked)}
						/>
					</div>
					<div className="col-md-6">
						<Form.Label>Country policy</Form.Label>
						<Form.Select
							value={countryAccessMode}
							onChange={(event) => setCountryAccessMode(event.target.value)}
						>
							<option value="disabled">Disabled</option>
							<option value="block">Block listed countries</option>
							<option value="allow">Allow only listed countries</option>
						</Form.Select>
					</div>
					<div className="col-md-6">
						<Form.Label>Blocked hostnames</Form.Label>
						<Form.Control
							value={blockedHostnames}
							onChange={(event) => setBlockedHostnames(event.target.value)}
							placeholder="bad.example.com, *.blocked.test"
						/>
					</div>
					<div className="col-md-6">
						<Form.Label>Blocked ports</Form.Label>
						<Form.Control
							value={blockedPorts}
							onChange={(event) => setBlockedPorts(event.target.value)}
							placeholder="8080, 8443"
						/>
					</div>
					<div className="col-md-6">
						<Form.Label>Country codes</Form.Label>
						<Form.Control
							value={countryAccessCodes}
							onChange={(event) => setCountryAccessCodes(event.target.value)}
							placeholder="US, CA, TW"
						/>
					</div>
					<div className="col-md-6">
						<Form.Label>Open-appsec agent token</Form.Label>
						<Form.Control
							type="password"
							value={openappsecAgentToken}
							onChange={(event) => setOpenappsecAgentToken(event.target.value)}
							autoComplete="new-password"
						/>
					</div>
					<div className="col-md-6">
						<Form.Label>Credential username</Form.Label>
						<Form.Control
							value={credentialUsername}
							onChange={(event) => setCredentialUsername(event.target.value)}
							autoComplete="username"
						/>
					</div>
					<div className="col-md-6">
						<Form.Label>Credential password</Form.Label>
						<Form.Control
							type="password"
							value={credentialPassword}
							onChange={(event) => setCredentialPassword(event.target.value)}
							autoComplete="new-password"
						/>
					</div>
				</div>
			</div>
			<div className="card-footer text-end">
				<Button type="submit" className="btn-teal" isLoading={isSubmitting} disabled={isSubmitting}>
					Save security policy
				</Button>
			</div>
		</Form>
	);
}
