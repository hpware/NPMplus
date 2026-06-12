import { IconSettings } from "@tabler/icons-react";
import CodeEditor from "@uiw/react-textarea-code-editor";
import cn from "classnames";
import EasyModal, { type InnerModalProps } from "ez-modal-react";
import { Field, Form, Formik } from "formik";
import { type ReactNode, useState } from "react";
import { Alert } from "react-bootstrap";
import Modal from "react-bootstrap/Modal";
import {
	AccessFields,
	Button,
	DomainNamesField,
	HasPermission,
	Loading,
	LocationsFields,
	NginxConfigField,
	SSLCertificateField,
	SSLOptionsFields,
} from "src/components";
import { useProxyHost, useSetProxyHost, useUser } from "src/hooks";
import { intl, T } from "src/locale";
import { MANAGE, PROXY_HOSTS } from "src/modules/Permissions";
import { validateNumber, validateUpstreamUrl } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

interface Props extends InnerModalProps {
	id: number | "new";
	isClone?: boolean;
}

const ProxyHostModal = EasyModal.create(({ id, isClone = false, visible, remove }: Props) => {
	const { data: currentUser, isLoading: userIsLoading, error: userError } = useUser("me");
	const { data, isLoading, error } = useProxyHost(id);
	const { mutate: setProxyHost } = useSetProxyHost();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [advVisible, setAdvVisible] = useState(false);

	const onSubmit = async (values: any, { setSubmitting }: any) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		// Set the unrestricted acls here (remove any data in their acl lists)
		const globalType = values.npmplusAccessListType;
		let globalAclIds = values.npmplusAccessListIds || [];
		if (globalType === "public") {
			globalAclIds = [];
		}
		const locations = (values.locations || []).map((loc: any) => {
			const newLoc = { ...loc };
			if (loc.npmplusAccessListType === "global" || loc.npmplusAccessListType === "public") {
				newLoc.npmplusAccessListIds = [];
			}
			return newLoc;
		});

		const { ...payload } = {
			id: id === "new" || isClone ? undefined : id,
			...values,
			meta: {
				...(values.meta || {}),
				custom_error_page_4xx: values.customErrorPage4xx || "",
				custom_error_page_5xx: values.customErrorPage5xx || "",
				country_access_mode: values.countryAccessMode || "disabled",
				country_access_codes: (values.countryAccessCodes || "").toUpperCase(),
			},
			npmplusAccessListIds: globalAclIds,
			locations,
			forwardPort: values.forwardPort || null,
			failbackPort: values.failbackEnabled ? values.failbackPort || null : null,
			failbackHost: values.failbackEnabled ? values.failbackHost || "" : "",
		};

		setProxyHost(payload, {
			onError: (err: any) => {
				if (err.payload?.debug?.stack) {
					setErrorMsg(
						<div className="w-100">
							<T id={err.message} />
							<pre>
								<code>{err.payload.debug.stack.join("\n")}</code>
							</pre>
						</div>,
					);
				} else {
					setErrorMsg(<T id={err.message} />);
				}
			},
			onSuccess: () => {
				showObjectSuccess("proxy-host", "saved");
				remove();
			},
			onSettled: () => {
				setIsSubmitting(false);
				setSubmitting(false);
			},
		});
	};

	return (
		<Modal show={visible} onHide={remove}>
			{!isLoading && (error || userError) && (
				<Alert variant="danger" className="m-3">
					{error?.message || userError?.message || "Unknown error"}
				</Alert>
			)}
			{isLoading || (userIsLoading && <Loading noLogo />)}
			{!isLoading && !userIsLoading && data && currentUser && (
				<Formik
					initialValues={
						{
							// Details tab
							domainNames: data?.domainNames || [],
							forwardScheme: data?.forwardScheme || "http",
							forwardHost: data?.forwardHost || "",
							forwardPort: data?.forwardPort || undefined,
							npmplusAccessListIds: data?.npmplusAccessListIds || [],
							npmplusAccessListType: data?.npmplusAccessListType || "public",
							cachingEnabled: data?.cachingEnabled || false,
							blockExploits: data?.blockExploits || false,
							allowWebsocketUpgrade: data?.allowWebsocketUpgrade || true,
							// Locations tab
							locations: data?.locations || [],
							// SSL tab
							certificateId: data?.certificateId || 0,
							sslForced: data?.sslForced || false,
							http2Support: data?.http2Support || true,
							npmplusHttp3Support: data?.npmplusHttp3Support || false,
							hstsEnabled: data?.hstsEnabled || false,
							hstsSubdomains: data?.hstsSubdomains || false,
							trustForwardedProto: data?.trustForwardedProto || false,
							// Advanced tab
							advancedConfig: data?.advancedConfig || "",
							npmplusLocationConfig: data?.npmplusLocationConfig || "",
							meta: data?.meta || {},
							npmplusNoindex: data?.npmplusNoindex || false,
							npmplusCrowdsecAppsec: data?.npmplusCrowdsecAppsec || false,
							npmplusProxyResponseBuffering: data?.npmplusProxyResponseBuffering || false,
							npmplusProxyRequestBuffering: data?.npmplusProxyRequestBuffering || false,
							npmplusDisableUriSanitisation:
								(data?.npmplusDisableUriSanitisation || false) &&
								["http", "https"].includes(data?.forwardScheme || "http") &&
								!(data?.forwardHost || "").includes("/"),
							npmplusSpoofHostHeader: data?.npmplusSpoofHostHeader || false,
							npmplusUpstreamCompression: data?.npmplusUpstreamCompression || false,
							npmplusFancyindex: data?.npmplusFancyindex || false,
							npmplusXFrameOptions: data?.npmplusXFrameOptions || "SAMEORIGIN",
							npmplusAuthRequest: data?.npmplusAuthRequest || "none",
							npmplusAuthRequestUpstream: data?.npmplusAuthRequestUpstream || "",
							failbackEnabled: data?.failbackEnabled || false,
							failbackHost: data?.failbackHost || "",
							failbackPort: data?.failbackPort || undefined,
							customErrorPage4xx: data?.meta?.customErrorPage4xx || "",
							customErrorPage5xx: data?.meta?.customErrorPage5xx || "",
							countryAccessMode: data?.meta?.countryAccessMode || "disabled",
							countryAccessCodes: data?.meta?.countryAccessCodes || "",
						} as any
					}
					onSubmit={onSubmit}
				>
					{({ values }: any) => (
						<Form>
							<Modal.Header closeButton>
								<Modal.Title>
									<T
										id={isClone ? "object.add" : data?.id ? "object.edit" : "object.add"}
										tData={{ object: "proxy-host" }}
									/>
								</Modal.Title>
							</Modal.Header>
							<Modal.Body className="p-0">
								<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
									{errorMsg}
								</Alert>
								<div className="card m-0 border-0">
									<div className="card-header">
										<ul className="nav nav-tabs card-header-tabs" data-bs-toggle="tabs">
											<li className="nav-item" role="presentation">
												<a
													href="#tab-details"
													className="nav-link active"
													data-bs-toggle="tab"
													aria-selected="true"
													role="tab"
												>
													<T id="column.details" />
												</a>
											</li>
											<li className="nav-item" role="presentation">
												<a
													href="#tab-locations"
													className="nav-link"
													data-bs-toggle="tab"
													aria-selected="false"
													tabIndex={-1}
													role="tab"
												>
													{<T id="column.custom-locations" />}
													{values?.locations?.length > 0 ? "*" : ""}
												</a>
											</li>
											<li className="nav-item" role="presentation">
												<a
													href="#tab-ssl"
													className="nav-link"
													data-bs-toggle="tab"
													aria-selected="false"
													tabIndex={-1}
													role="tab"
												>
													<T id="column.ssl" />
												</a>
											</li>
											<li className="nav-item ms-auto" role="presentation">
												<a
													href="#tab-advanced"
													className="nav-link"
													title="Settings"
													data-bs-toggle="tab"
													aria-selected="false"
													tabIndex={-1}
													role="tab"
												>
													<T id="domains.advanced" />
													{values?.advancedConfig?.trim() ? " *" : ""}
												</a>
											</li>
										</ul>
									</div>
									<div className="card-body">
										<div className="tab-content">
											<div className="tab-pane active show" id="tab-details" role="tabpanel">
												<DomainNamesField isWildcardPermitted dnsProviderWildcardSupported />
												<div className="row">
													<div className="col-md-3">
														<Field name="forwardScheme">
															{({ field, form }: any) => (
																<div className="mb-3">
																	<label
																		className="form-label"
																		htmlFor="forwardScheme"
																	>
																		<T id="host.forward-scheme" />
																	</label>
																	<select
																		id="forwardScheme"
																		className={`form-select ${form.errors.forwardScheme && form.touched.forwardScheme ? "is-invalid" : ""}`}
																		required
																		{...field}
																		onChange={(e) => {
																			field.onChange(e);
																			const scheme = e.target.value;
																			if (scheme === "empty") return;
																			if (!["http", "https"].includes(scheme)) {
																				form.setFieldValue(
																					"npmplusProxyRequestBuffering",
																					false,
																				);
																				form.setFieldValue(
																					"npmplusProxyResponseBuffering",
																					false,
																				);
																				form.setFieldValue(
																					"npmplusDisableUriSanitisation",
																					false,
																				);
																			}
																			if (scheme === "path") {
																				form.setFieldValue(
																					"npmplusUpstreamCompression",
																					false,
																				);
																				form.setFieldValue(
																					"npmplusSpoofHostHeader",
																					false,
																				);
																			} else {
																				form.setFieldValue(
																					"npmplusFancyindex",
																					false,
																				);
																			}
																		}}
																	>
																		<option value="http">http://</option>
																		<option value="https">https://</option>
																		<option value="path">path: </option>
																		<option value="empty">empty</option>
																		<option value="grpc">grpc://</option>
																		<option value="grpcs">grpcs://</option>
																	</select>
																	{form.errors.forwardScheme ? (
																		<div className="invalid-feedback">
																			{form.errors.forwardScheme &&
																			form.touched.forwardScheme
																				? form.errors.forwardScheme
																				: null}
																		</div>
																	) : null}
																</div>
															)}
														</Field>
													</div>
													<div className="col-md-5">
														<Field name="forwardHost">
															{({ field, form }: any) => (
																<div className="mb-3">
																	<label className="form-label" htmlFor="forwardHost">
																		<T id="proxy-host.forward-host-path" />
																	</label>
																	<input
																		id="forwardHost"
																		type="text"
																		className={`form-control ${form.errors.forwardHost && form.touched.forwardHost ? "is-invalid" : ""}`}
																		placeholder="example.com"
																		{...field}
																		onChange={(e) => {
																			field.onChange(e);
																			if (e.target.value.includes("/"))
																				form.setFieldValue(
																					"npmplusDisableUriSanitisation",
																					false,
																				);
																		}}
																	/>
																	{form.errors.forwardHost ? (
																		<div className="invalid-feedback">
																			{form.errors.forwardHost &&
																			form.touched.forwardHost
																				? form.errors.forwardHost
																				: null}
																		</div>
																	) : null}
																</div>
															)}
														</Field>
													</div>
													<div className="col-md-3">
														<Field name="forwardPort" validate={validateNumber(-1, 65535)}>
															{({ field, form }: any) => (
																<div className="mb-3">
																	<label className="form-label" htmlFor="forwardPort">
																		<T id="host.forward-port" />
																	</label>
																	<input
																		id="forwardPort"
																		type="text"
																		inputMode="numeric"
																		pattern="[0-9]*"
																		className={`form-control ${form.errors.forwardPort && form.touched.forwardPort ? "is-invalid" : ""}`}
																		placeholder="eg: 8081"
																		{...field}
																	/>
																	{form.errors.forwardPort ? (
																		<div className="invalid-feedback">
																			{form.errors.forwardPort &&
																			form.touched.forwardPort
																				? form.errors.forwardPort
																				: null}
																		</div>
																	) : null}
																</div>
															)}
														</Field>
													</div>
													<div className="col-md-1 text-end">
														<div className="mb-3">
															<div className="form-label invisible">​</div>
															<button
																type="button"
																className="btn p-0"
																title="LocationConfig"
																onClick={() => setAdvVisible((prev) => !prev)}
															>
																<IconSettings size={20} />
																{values?.npmplusLocationConfig?.trim() ? "*" : ""}
															</button>
														</div>
													</div>
												</div>
												<div className="row">
													<h4 className="py-2">
														<T id="proxy-host.global-access-lists" />
													</h4>
													<AccessFields
														initialAccessListType={data?.npmplusAccessListType || "public"}
														initialAccessListIds={data?.npmplusAccessListIds || []}
														name="npmplusAccessListIds"
														type="npmplusAccessListType"
													/>
												</div>
												<div className="my-3">
													<h4 className="py-2">Failback</h4>
													<div className="divide-y">
														<div>
															<label className="row" htmlFor="failbackEnabled">
																<span className="col">
																	Use a backup upstream if the primary is unavailable
																</span>
																<span className="col-auto">
																	<Field name="failbackEnabled" type="checkbox">
																		{({ field }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="failbackEnabled"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
													</div>
													{values.failbackEnabled && (
														<div className="row mt-3">
															<div className="col-md-8">
																<Field name="failbackHost">
																	{({ field, form }: any) => (
																		<div className="mb-3">
																			<label
																				className="form-label"
																				htmlFor="failbackHost"
																			>
																				Backup host
																			</label>
																			<input
																				id="failbackHost"
																				type="text"
																				className={`form-control ${form.errors.failbackHost && form.touched.failbackHost ? "is-invalid" : ""}`}
																				placeholder="backup.example.com"
																				{...field}
																			/>
																		</div>
																	)}
																</Field>
															</div>
															<div className="col-md-4">
																<Field
																	name="failbackPort"
																	validate={validateNumber(1, 65535)}
																>
																	{({ field, form }: any) => (
																		<div className="mb-3">
																			<label
																				className="form-label"
																				htmlFor="failbackPort"
																			>
																				Backup port
																			</label>
																			<input
																				id="failbackPort"
																				type="text"
																				inputMode="numeric"
																				pattern="[0-9]*"
																				className={`form-control ${form.errors.failbackPort && form.touched.failbackPort ? "is-invalid" : ""}`}
																				placeholder="eg: 8082"
																				{...field}
																			/>
																		</div>
																	)}
																</Field>
															</div>
														</div>
													)}
												</div>
												<div className="my-3">
													<h4 className="py-2">
														<T id="options" />
													</h4>
													<div className="divide-y">
														<div style={{ display: "none" }}>
															<label className="row" htmlFor="cachingEnabled">
																<span className="col">
																	<T id="host.flags.cache-assets" />
																</span>
																<span className="col-auto">
																	<Field name="cachingEnabled" type="checkbox">
																		{({ field }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="cachingEnabled"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div style={{ display: "none" }}>
															<label className="row" htmlFor="blockExploits">
																<span className="col">
																	<T id="host.flags.block-exploits" />
																</span>
																<span className="col-auto">
																	<Field name="blockExploits" type="checkbox">
																		{({ field }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="blockExploits"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div style={{ display: "none" }}>
															<label className="row" htmlFor="allowWebsocketUpgrade">
																<span className="col">
																	<T id="host.flags.websockets-upgrade" />
																</span>
																<span className="col-auto">
																	<Field name="allowWebsocketUpgrade" type="checkbox">
																		{({ field }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="allowWebsocketUpgrade"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label className="row" htmlFor="npmplusNoindex">
																<span className="col">
																	<T id="host.flags.send-noindex" />
																</span>
																<span className="col-auto">
																	<Field name="npmplusNoindex" type="checkbox">
																		{({ field }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="npmplusNoindex"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label className="row" htmlFor="npmplusCrowdsecAppsec">
																<span className="col">
																	<T id="host.flags.disable-crowdsec-appsec" />
																</span>
																<span className="col-auto">
																	<Field name="npmplusCrowdsecAppsec" type="checkbox">
																		{({ field, form }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="npmplusCrowdsecAppsec"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																					onChange={(e) => {
																						field.onChange(e);
																						if (!e.target.checked)
																							form.setFieldValue(
																								"npmplusProxyRequestBuffering",
																								false,
																							);
																					}}
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label
																className="row"
																htmlFor="npmplusProxyRequestBuffering"
															>
																<span className="col">
																	<T id="host.flags.disable-request-buffering" />
																</span>
																<span className="col-auto">
																	<Field
																		name="npmplusProxyRequestBuffering"
																		type="checkbox"
																	>
																		{({ field, form }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="npmplusProxyRequestBuffering"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																					onChange={(e) => {
																						field.onChange(e);
																						if (e.target.checked)
																							form.setFieldValue(
																								"npmplusCrowdsecAppsec",
																								true,
																							);
																					}}
																					disabled={
																						form.values.forwardScheme !==
																							"http" &&
																						form.values.forwardScheme !==
																							"https"
																					}
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label
																className="row"
																htmlFor="npmplusProxyResponseBuffering"
															>
																<span className="col">
																	<T id="host.flags.disable-response-buffering" />
																</span>
																<span className="col-auto">
																	<Field
																		name="npmplusProxyResponseBuffering"
																		type="checkbox"
																	>
																		{({ field, form }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="npmplusProxyResponseBuffering"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																					disabled={
																						form.values.forwardScheme !==
																							"http" &&
																						form.values.forwardScheme !==
																							"https"
																					}
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label className="row" htmlFor="npmplusUpstreamCompression">
																<span className="col">
																	<T id="host.flags.upstream-compression" />
																</span>
																<span className="col-auto">
																	<Field
																		name="npmplusUpstreamCompression"
																		type="checkbox"
																	>
																		{({ field, form }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="npmplusUpstreamCompression"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																					disabled={[
																						"path",
																						"empty",
																					].includes(
																						form.values.forwardScheme,
																					)}
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label
																className="row"
																htmlFor="npmplusDisableUriSanitisation"
															>
																<span className="col">
																	<T id="host.flags.disable-uri-sanitisation" />
																</span>
																<span className="col-auto">
																	<Field
																		name="npmplusDisableUriSanitisation"
																		type="checkbox"
																	>
																		{({ field, form }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="npmplusDisableUriSanitisation"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																					disabled={
																						!["http", "https"].includes(
																							form.values.forwardScheme,
																						) ||
																						(
																							form.values.forwardHost ||
																							""
																						).includes("/")
																					}
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label className="row" htmlFor="npmplusSpoofHostHeader">
																<span className="col">
																	<T id="host.flags.spoof-host-header" />
																</span>
																<span className="col-auto">
																	<Field
																		name="npmplusSpoofHostHeader"
																		type="checkbox"
																	>
																		{({ field, form }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="npmplusSpoofHostHeader"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																					disabled={
																						![
																							"http",
																							"https",
																							"grpc",
																							"grpcs",
																						].includes(
																							form.values.forwardScheme,
																						)
																					}
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label className="row" htmlFor="npmplusFancyindex">
																<span className="col">
																	<T id="host.flags.fancyindex" />
																</span>
																<span className="col-auto">
																	<Field name="npmplusFancyindex" type="checkbox">
																		{({ field, form }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="npmplusFancyindex"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																					disabled={
																						form.values.forwardScheme !==
																						"path"
																					}
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label className="row" htmlFor="npmplusXFrameOptions">
																<span className="col">X-Frame-Options</span>
																<span className="col-auto">
																	<Field name="npmplusXFrameOptions">
																		{({ field, form }: any) => (
																			<label>
																				<select
																					id="npmplusXFrameOptions"
																					className={`form-select ${form.errors.npmplusXFrameOptions && form.touched.npmplusXFrameOptions ? "is-invalid" : ""}`}
																					required
																					{...field}
																				>
																					<option value="SAMEORIGIN">
																						SAMEORIGIN
																					</option>
																					<option value="DENY">DENY</option>
																					<option value="none">none</option>
																					<option value="upstream">
																						upstream
																					</option>
																				</select>
																				{form.errors.npmplusXFrameOptions ? (
																					<div className="invalid-feedback">
																						{form.errors
																							.npmplusXFrameOptions &&
																						form.touched
																							.npmplusXFrameOptions
																							? form.errors
																									.npmplusXFrameOptions
																							: null}
																					</div>
																				) : null}
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label className="row" htmlFor="npmplusAuthRequest">
																<span className="col">
																	<T id="host.auth-request" />
																</span>
																<span className="col-auto">
																	<Field name="npmplusAuthRequest">
																		{({ field, form }: any) => (
																			<label>
																				<select
																					id="npmplusAuthRequest"
																					className={`form-select ${form.errors.npmplusAuthRequest && form.touched.npmplusAuthRequest ? "is-invalid" : ""}`}
																					required
																					{...field}
																				>
																					<option value="none">none</option>
																					<option value="anubis">
																						anubis
																					</option>
																					<option value="tinyauth">
																						tinyauth
																					</option>
																					<option value="oauth2proxy">
																						oauth2proxy
																					</option>
																					<option value="voidauth">
																						voidauth
																					</option>
																					<option value="authelia">
																						authelia (modern)
																					</option>
																					<option value="authentik">
																						authentik
																					</option>
																					<option value="authentik-send-basic-auth">
																						authentik-send-basic-auth
																					</option>
																				</select>
																				{form.errors.npmplusAuthRequest ? (
																					<div className="invalid-feedback">
																						{form.errors
																							.npmplusAuthRequest &&
																						form.touched.npmplusAuthRequest
																							? form.errors
																									.npmplusAuthRequest
																							: null}
																					</div>
																				) : null}
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														{values.npmplusAuthRequest !== "none" && (
															<div>
																<label
																	className="row"
																	htmlFor="npmplusAuthRequestUpstream"
																>
																	<span className="col">
																		<T id="host.auth-request-upstream" />
																	</span>
																	<span className="col-auto">
																		<Field
																			name="npmplusAuthRequestUpstream"
																			validate={validateUpstreamUrl()}
																		>
																			{({ field, form }: any) => (
																				<label>
																					<input
																						id="npmplusAuthRequestUpstream"
																						type="text"
																						className={`form-control ${form.errors.npmplusAuthRequestUpstream && form.touched.npmplusAuthRequestUpstream ? "is-invalid" : ""}`}
																						placeholder="keep empty to reuse env value"
																						pattern="^https?://([^/:]+|\[[a-fA-F0-9:]+\]):[0-9]+$"
																						{...field}
																					/>
																					{form.errors
																						.npmplusAuthRequestUpstream ? (
																						<div className="invalid-feedback">
																							{form.errors
																								.npmplusAuthRequestUpstream &&
																							form.touched
																								.npmplusAuthRequestUpstream
																								? form.errors
																										.npmplusAuthRequestUpstream
																								: null}
																						</div>
																					) : null}
																				</label>
																			)}
																		</Field>
																	</span>
																</label>
															</div>
														)}
													</div>
												</div>
												<Field name="npmplusLocationConfig">
													{({ field }: any) => (
														<>
															{advVisible && (
																<div className="">
																	<CodeEditor
																		language="nginx"
																		placeholder={intl.formatMessage({
																			id: "nginx-config.placeholder",
																		})}
																		padding={15}
																		data-color-mode="dark"
																		minHeight={170}
																		indentWidth={2}
																		style={{
																			fontFamily:
																				"ui-monospace,SFMono-Regular,SF Mono,Consolas,Liberation Mono,Menlo,monospace",
																			borderRadius: "0.3rem",
																			minHeight: "170px",
																		}}
																		{...field}
																	/>
																</div>
															)}
														</>
													)}
												</Field>
											</div>
											<div className="tab-pane" id="tab-locations" role="tabpanel">
												<LocationsFields
													initialValues={(data?.locations || []).map((loc: any) => ({
														...loc,
														npmplusDisableUriSanitisation:
															(loc.npmplusDisableUriSanitisation ?? true) &&
															["http", "https"].includes(loc.forwardScheme || "http") &&
															!(loc.forwardHost || "").includes("/"),
													}))}
												/>
											</div>
											<div className="tab-pane" id="tab-ssl" role="tabpanel">
												<SSLCertificateField
													name="certificateId"
													label="ssl-certificate"
													allowNew
												/>
												<SSLOptionsFields color="bg-lime" forProxyHost={true} />
											</div>
											<div className="tab-pane" id="tab-advanced" role="tabpanel">
												<div className="mb-4">
													<h4 className="py-2">Custom error pages</h4>
													<div className="mb-3">
														<Field name="customErrorPage4xx">
															{({ field }: any) => (
																<>
																	<label
																		className="form-label"
																		htmlFor="customErrorPage4xx"
																	>
																		4xx page HTML
																	</label>
																	<CodeEditor
																		id="customErrorPage4xx"
																		language="html"
																		placeholder="<h1>Not available</h1>"
																		padding={15}
																		data-color-mode="dark"
																		minHeight={120}
																		indentWidth={2}
																		style={{
																			fontFamily:
																				"ui-monospace,SFMono-Regular,SF Mono,Consolas,Liberation Mono,Menlo,monospace",
																			borderRadius: "0.3rem",
																			minHeight: "120px",
																		}}
																		{...field}
																	/>
																</>
															)}
														</Field>
													</div>
													<div className="mb-3">
														<Field name="customErrorPage5xx">
															{({ field }: any) => (
																<>
																	<label
																		className="form-label"
																		htmlFor="customErrorPage5xx"
																	>
																		5xx page HTML
																	</label>
																	<CodeEditor
																		id="customErrorPage5xx"
																		language="html"
																		placeholder="<h1>Service temporarily unavailable</h1>"
																		padding={15}
																		data-color-mode="dark"
																		minHeight={120}
																		indentWidth={2}
																		style={{
																			fontFamily:
																				"ui-monospace,SFMono-Regular,SF Mono,Consolas,Liberation Mono,Menlo,monospace",
																			borderRadius: "0.3rem",
																			minHeight: "120px",
																		}}
																		{...field}
																	/>
																</>
															)}
														</Field>
													</div>
												</div>
												<div className="mb-4">
													<h4 className="py-2">Country access</h4>
													<div className="row">
														<div className="col-md-4">
															<Field name="countryAccessMode">
																{({ field }: any) => (
																	<div className="mb-3">
																		<label
																			className="form-label"
																			htmlFor="countryAccessMode"
																		>
																			Mode
																		</label>
																		<select
																			id="countryAccessMode"
																			className="form-select"
																			{...field}
																		>
																			<option value="disabled">Disabled</option>
																			<option value="block">
																				Block countries
																			</option>
																			<option value="allow">
																				Allow only countries
																			</option>
																		</select>
																	</div>
																)}
															</Field>
														</div>
														<div className="col-md-8">
															<Field name="countryAccessCodes">
																{({ field }: any) => (
																	<div className="mb-3">
																		<label
																			className="form-label"
																			htmlFor="countryAccessCodes"
																		>
																			Country codes
																		</label>
																		<input
																			id="countryAccessCodes"
																			type="text"
																			className="form-control"
																			placeholder="US,CA,GB"
																			{...field}
																		/>
																		<div className="form-hint">
																			Requires GeoIP2 and
																			NPMPLUS_GEOIP_COUNTRY_BLOCKING=true.
																		</div>
																	</div>
																)}
															</Field>
														</div>
													</div>
												</div>
												<NginxConfigField />
											</div>
										</div>
									</div>
								</div>
							</Modal.Body>
							<Modal.Footer>
								<Button data-bs-dismiss="modal" onClick={remove} disabled={isSubmitting}>
									<T id="cancel" />
								</Button>
								<HasPermission section={PROXY_HOSTS} permission={MANAGE} hideError>
									<Button
										type="submit"
										actionType="primary"
										className="ms-auto bg-lime"
										data-bs-dismiss="modal"
										isLoading={isSubmitting}
										disabled={isSubmitting}
									>
										<T id="save" />
									</Button>
								</HasPermission>
							</Modal.Footer>
						</Form>
					)}
				</Formik>
			)}
		</Modal>
	);
});

const showProxyHostModal = (id: number | "new", isClone = false) => {
	EasyModal.show(ProxyHostModal, { id, isClone } as Omit<Props, "visible" | "remove">);
};

export { showProxyHostModal };
