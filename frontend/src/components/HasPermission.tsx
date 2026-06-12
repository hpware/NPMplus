import type { ReactNode } from "react";
import Alert from "react-bootstrap/Alert";
import { Button, Loading, LoadingPage } from "src/components";
import { useAuthState } from "src/context";
import { useUser } from "src/hooks";
import { T } from "src/locale";
import { type ADMIN, hasPermission, type Permission, type Section } from "src/modules/Permissions";

interface Props {
	section?: Section | typeof ADMIN;
	permission: Permission;
	hideError?: boolean;
	children?: ReactNode;
	pageLoading?: boolean;
	loadingNoLogo?: boolean;
}
function HasPermission({
	section,
	permission,
	children,
	hideError = false,
	pageLoading = false,
	loadingNoLogo = false,
}: Props) {
	const { data, isLoading } = useUser("me");
	const { logout } = useAuthState();

	if (!section) {
		return <>{children}</>;
	}

	if (isLoading) {
		if (hideError) {
			return null;
		}
		if (pageLoading) {
			return <LoadingPage noLogo={loadingNoLogo} />;
		}
		return <Loading noLogo={loadingNoLogo} />;
	}

	const allowed = hasPermission(section, permission, data?.permissions, data?.roles);
	if (allowed) {
		return <>{children}</>;
	}

	return !hideError ? (
		<Alert variant="warning">
			<div className="d-flex flex-column flex-md-row gap-3 align-items-md-center justify-content-between">
				<div>
					<div className="fw-bold">
						<T id="no-permission-error" />
					</div>
					<div className="text-secondary">
						This account is signed in but does not have access to this area. Ask an admin to adjust this
						user's permissions, or sign in with another account.
					</div>
				</div>
				<Button color="orange" onClick={logout}>
					Sign out
				</Button>
			</div>
		</Alert>
	) : null;
}

export { HasPermission };
