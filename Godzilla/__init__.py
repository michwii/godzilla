import datetime
import logging
import os

import azure.functions as func
import json
import urllib.error
import urllib.parse
import urllib.request

from opencensus.ext.azure.log_exporter import AzureLogHandler

SUBSCRIPTION_ID = os.getenv("SUBSCRIPTION_ID")
TENANT_ID = os.getenv("TENANT_ID")
CLIENT_ID = os.getenv("CLIENT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
RESOURCE_GROUP_EXCLUSIONS = os.getenv("RESOURCE_GROUP_EXCLUSIONS")
DELAY_BEFORE_DESTRUCTION = os.getenv("DELAY_BEFORE_DESTRUCTION")


def _configure_application_insights_logging():
    """Send Python function logs to the configured Application Insights resource."""
    connection_string = os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING")
    if not connection_string:
        return

    root_logger = logging.getLogger()
    if any(isinstance(handler, AzureLogHandler) for handler in root_logger.handlers):
        return

    handler = AzureLogHandler(connection_string=connection_string)
    handler.setLevel(logging.INFO)
    root_logger.addHandler(handler)
    root_logger.setLevel(logging.INFO)


_configure_application_insights_logging()


def _parse_exclusions(value):
    if not value:
        return None
    return [item.strip().upper() for item in value.split(",") if item.strip()]


RESOURCE_GROUP_EXCLUSIONS_LIST = _parse_exclusions(RESOURCE_GROUP_EXCLUSIONS)


def _all_requirements_present():
    return all(
        [
            SUBSCRIPTION_ID,
            TENANT_ID,
            CLIENT_ID,
            CLIENT_SECRET,
            RESOURCE_GROUP_EXCLUSIONS_LIST,
            DELAY_BEFORE_DESTRUCTION,
        ]
    )


def _is_managed_resource_group(name):
    lowered = name.lower()
    return lowered.startswith("ai_") and lowered.endswith("_managed")


def _get_access_token(tenant_id, client_id, client_secret):
    url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/token"
    data = {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "resource": "https://management.azure.com/",
    }
    body = urllib.parse.urlencode(data).encode("utf-8")
    request = urllib.request.Request(url, data=body, method="POST")
    request.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Token request failed: {exc.code}") from exc
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("No access token received from Azure AD.")
    return token


def _get_data_from_ms_api(access_token, url, method="GET"):
    request = urllib.request.Request(url, method=method)
    request.add_header("Authorization", f"Bearer {access_token}")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            if method == "DELETE":
                return None
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        code = None
        message = None
        try:
            details = json.loads(body)
            code = details.get("error", {}).get("code")
            message = details.get("error", {}).get("message")
        except Exception:
            pass
        details = f" {code}: {message}" if code or message else ""
        raise RuntimeError(
            f"MS API request failed: {exc.code} {method} {url}{details}"
        ) from exc
    return payload.get("value", [])


def _get_resource_group_list(subscription_id, access_token):
    url = (
        "https://management.azure.com/subscriptions/"
        f"{subscription_id}/resourcegroups?api-version=2017-05-10"
    )
    return _get_data_from_ms_api(access_token, url)


def _get_deployments_history_by_resource_group(subscription_id, access_token, resource_group):
    url = (
        "https://management.azure.com/subscriptions/"
        f"{subscription_id}/resourcegroups/{resource_group}/"
        "providers/Microsoft.Resources/deployments/?api-version=2018-02-01"
    )
    return _get_data_from_ms_api(access_token, url)


def _get_last_deployment(deployments_history):
    last_date = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
    for deployment in deployments_history:
        timestamp = deployment.get("properties", {}).get("timestamp")
        if not timestamp:
            continue
        try:
            deployment_date = datetime.datetime.fromisoformat(
                timestamp.replace("Z", "+00:00")
            )
        except ValueError:
            continue
        if deployment_date > last_date:
            last_date = deployment_date
    return last_date


def _can_destroy_resource_group(deployments_history, deadline):
    latest = _get_last_deployment(deployments_history)
    return latest <= deadline


def _delete_resource_group(subscription_id, access_token, resource_group_name):
    url = (
        "https://management.azure.com/subscriptions/"
        f"{subscription_id}/resourcegroups/{resource_group_name}?api-version=2018-02-01"
    )
    _get_data_from_ms_api(access_token, url, method="DELETE")

def _is_resource_lock_error(message):
    if not message:
        return False
    lowered = message.lower()
    return (
        "scopelocked" in lowered
        or "cannotdelete" in lowered
        or "can not delete" in lowered
        or "lock" in lowered
    )


def _delete_unused_resource_groups(deadline):
    access_token = _get_access_token(TENANT_ID, CLIENT_ID, CLIENT_SECRET)
    resource_groups = _get_resource_group_list(SUBSCRIPTION_ID, access_token)
    resource_groups_to_delete = []
    excluded_count = 0
    deletion_errors = []
    deletions_requested = 0

    for resource_group in resource_groups:
        name = resource_group.get("name")
        if not name:
            continue
        if _is_managed_resource_group(name):
            excluded_count += 1
            logging.info("Managed resource group excluded from destruction: %s", name)
            continue
        if name.upper() in RESOURCE_GROUP_EXCLUSIONS_LIST:
            excluded_count += 1
            logging.info("Resource group excluded from destruction: %s", name)
            continue
        try:
            deployments = _get_deployments_history_by_resource_group(
                SUBSCRIPTION_ID, access_token, name
            )
        except Exception as exc:
            logging.exception(
                "Failed to retrieve deployments history for resource group: %s", name
            )
            deletion_errors.append({"resource_group": name, "step": "deployments", "error": str(exc)})
            continue

        if _can_destroy_resource_group(deployments, deadline):
            resource_groups_to_delete.append(name)
            logging.info("Resource group marked for deletion: %s", name)

    for name in resource_groups_to_delete:
        try:
            _delete_resource_group(SUBSCRIPTION_ID, access_token, name)
            logging.info("Resource group deletion requested: %s", name)
            deletions_requested += 1
        except Exception as exc:
            message = str(exc)
            if _is_resource_lock_error(message):
                logging.warning(
                    "Resource group not deleted due to resource lock: %s (%s)", name, message
                )
            else:
                logging.exception("Failed to delete resource group: %s", name)
            deletion_errors.append({"resource_group": name, "step": "delete", "error": message})

    return {
        "evaluated": len(resource_groups),
        "excluded": excluded_count,
        "deletion_candidates": len(resource_groups_to_delete),
        "deletions": deletions_requested,
        "deletion_errors": len(deletion_errors),
    }


def run_cleanup():
    try:
        if not _all_requirements_present():
            message = (
                "Missing required environment variables. Required: TENANT_ID, "
                "SUBSCRIPTION_ID, DELAY_BEFORE_DESTRUCTION, CLIENT_ID, CLIENT_SECRET, "
                "RESOURCE_GROUP_EXCLUSIONS"
            )
            logging.error(message)
            return None, message

        configured_delay_seconds = int(DELAY_BEFORE_DESTRUCTION)
        delay_seconds = max(configured_delay_seconds, 24 * 60 * 60)
        if configured_delay_seconds < delay_seconds:
            logging.warning(
                "DELAY_BEFORE_DESTRUCTION is below the one-day safety minimum; "
                "using %s seconds instead.",
                delay_seconds,
            )
        now = datetime.datetime.now(datetime.timezone.utc)
        deadline = now - datetime.timedelta(seconds=delay_seconds)

        logging.info(
            "Resource groups excluded from destruction: %s", RESOURCE_GROUP_EXCLUSIONS_LIST
        )
        logging.info("Deleting resource groups created before: %s", deadline.isoformat())
        logging.info("Starting analysis...")

        summary = _delete_unused_resource_groups(deadline)

        logging.info("Work completed.")
        logging.info("Summary: %s", summary)
        return summary, None
    except Exception as exc:
        logging.exception("Godzilla run failed.")
        return None, str(exc)


def main(mytimer: func.TimerRequest) -> None:
    if mytimer.past_due:
        logging.warning("Python is running late!")
    run_cleanup()
