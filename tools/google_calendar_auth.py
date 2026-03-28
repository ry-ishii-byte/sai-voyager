"""Google Calendar OAuth認証スクリプト"""

import json
import os
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

SCOPES = ["https://www.googleapis.com/auth/calendar"]

KEYS_FILE = os.path.join(
    os.path.dirname(__file__),
    "../reference/secrets/gcp-oauth.keys.json.json",
)
TOKEN_FILE = os.path.join(
    os.path.dirname(__file__),
    "../reference/secrets/google-calendar-token.json",
)


def authenticate():
    creds = None

    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(KEYS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)

        with open(TOKEN_FILE, "w") as f:
            f.write(creds.to_json())
        print(f"トークンを保存しました: {TOKEN_FILE}")

    print("認証成功！Google Calendarへのアクセスが可能です。")
    return creds


if __name__ == "__main__":
    authenticate()
