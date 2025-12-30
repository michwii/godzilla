import datetime
import logging
import os

import azure.functions as func
import requests


SUBSCRIPTION_ID = os.getenv("SUBSCRIPTION_ID")
TENANT_ID = os.getenv("TENANT_ID")
CLIENT_ID = os.getenv("CLIENT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
RESOURCE_GROUP_EXCLUSIONS = os.getenv("RESOURCE_GROUP_EXCLUSIONS")
DELAY_BEFORE_DESTRUCTION = os.getenv("DELAY_BEFORE_DESTRUCTION")


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


def _get_access_token(tenant_id, client_id, client_secret):
    url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/token"
    data = {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "resource": "https://management.core.windows.net/",
    }
    response = requests.post(url, data=data, timeout=30)
    response.raise_for_status()
    payload = response.json()
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("No access token received from Azure AD.")
    return token


def _get_data_from_ms_api(access_token, url, method="GET"):
    headers = {"Authorization": f"Bearer {access_token}"}
    response = requests.request(method, url, headers=headers, timeout=60)
    response.raise_for_status()
    if method == "DELETE":
        return None
    payload = response.json()
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


def _delete_unused_resource_groups(deadline):
    access_token = _get_access_token(TENANT_ID, CLIENT_ID, CLIENT_SECRET)
    resource_groups = _get_resource_group_list(SUBSCRIPTION_ID, access_token)
    resource_groups_to_delete = []
    excluded_count = 0

    for resource_group in resource_groups:
        name = resource_group.get("name")
        if not name:
            continue
        if name.upper() in RESOURCE_GROUP_EXCLUSIONS_LIST:
            excluded_count += 1
            logging.info("Resource group excluded from destruction: %s", name)
            continue
        deployments = _get_deployments_history_by_resource_group(
            SUBSCRIPTION_ID, access_token, name
        )
        if _can_destroy_resource_group(deployments, deadline):
            resource_groups_to_delete.append(name)
            logging.info("Resource group deleted: %s", name)

    for name in resource_groups_to_delete:
        _delete_resource_group(SUBSCRIPTION_ID, access_token, name)

    return {
        "evaluated": len(resource_groups),
        "excluded": excluded_count,
        "deletions": len(resource_groups_to_delete),
    }


def main(mytimer: func.TimerRequest) -> None:
    now = datetime.datetime.now(datetime.timezone.utc)

    if mytimer.past_due:
        logging.warning("Python is running late!")

    if not _all_requirements_present():
        logging.error("Missing required environment variables.")
        logging.error(
            "Required: TENANT_ID, SUBSCRIPTION_ID, DELAY_BEFORE_DESTRUCTION, CLIENT_ID, "
            "CLIENT_SECRET, RESOURCE_GROUP_EXCLUSIONS"
        )
        return

    delay_seconds = int(DELAY_BEFORE_DESTRUCTION)
    deadline = now - datetime.timedelta(seconds=delay_seconds)

    logging.info("Resource groups excluded from destruction: %s", RESOURCE_GROUP_EXCLUSIONS_LIST)
    logging.info("Deleting resource groups created before: %s", deadline.isoformat())
    logging.info("Starting analysis...")

    summary = _delete_unused_resource_groups(deadline)

    logging.info("Work completed.")
    logging.info("Summary: %s", summary)
