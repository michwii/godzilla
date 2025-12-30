import json
import logging

import azure.functions as func

from Godzilla import run_cleanup


def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Manual Godzilla trigger invoked.")
    summary, error = run_cleanup()

    if error:
        return func.HttpResponse(
            json.dumps({"ok": False, "error": error}),
            status_code=500,
            mimetype="application/json",
        )

    return func.HttpResponse(
        json.dumps({"ok": True, "summary": summary}),
        status_code=200,
        mimetype="application/json",
    )
