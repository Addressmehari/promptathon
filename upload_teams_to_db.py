import os
import re
import json
import urllib.request
import urllib.error
from datetime import datetime

def load_firebase_config():
    """Extracts Firebase project ID and API key from env.js"""
    if not os.path.exists('env.js'):
        raise FileNotFoundError("env.js not found in current directory.")
    
    with open('env.js', 'r', encoding='utf-8') as f:
        content = f.read()
    
    proj_match = re.search(r'FIREBASE_PROJECT_ID:\s*["\']([^"\']+)["\']', content)
    key_match = re.search(r'FIREBASE_API_KEY:\s*["\']([^"\']+)["\']', content)
    
    if not proj_match or not key_match:
        raise ValueError("Could not extract FIREBASE_PROJECT_ID or FIREBASE_API_KEY from env.js")
    
    return proj_match.group(1), key_match.group(1)

def upload_teams(collection_name="registrations"):
    """Reads teams-credentials.json and uploads each team to Firestore via REST API"""
    if not os.path.exists('teams-credentials.json'):
        raise FileNotFoundError("teams-credentials.json not found. Run generate_credentials.py first.")
    
    with open('teams-credentials.json', 'r', encoding='utf-8') as f:
        teams = json.load(f)
    
    project_id, api_key = load_firebase_config()
    print(f"Connecting to Firestore Project: {project_id}")
    print(f"Target Collection: '{collection_name}'")
    print(f"Teams to upload: {len(teams)}\n")
    
    success_count = 0
    fail_count = 0

    now_iso = datetime.utcnow().isoformat() + "Z"
    now_formatted = datetime.now().strftime("%m/%d/%Y, %I:%M:%S %p")

    for idx, team in enumerate(teams, 1):
        doc_id = team['teamId']
        # Extract numeric team number for admin dashboard sorting
        num_match = re.search(r'\d+', team['originalId'])
        team_num = int(num_match.group()) if num_match else idx

        fields = {
            "teamId": {"stringValue": team["teamId"]},
            "originalId": {"stringValue": team["originalId"]},
            "teamNumber": {"integerValue": str(team_num)},
            "teamName": {"stringValue": team["teamName"]},
            "leaderName": {"stringValue": team["leaderName"]},
            "participants": {"stringValue": team["participants"]},
            "password": {"stringValue": team["password"]},
            "status": {"stringValue": "active"},
            "createdAt": {"timestampValue": now_iso},
            "registeredAtFormatted": {"stringValue": now_formatted}
        }

        payload = {"fields": fields}
        url = (
            f"https://firestore.googleapis.com/v1/projects/{project_id}/"
            f"databases/(default)/documents/{collection_name}/{doc_id}?key={api_key}"
        )

        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='PATCH'
        )

        try:
            with urllib.request.urlopen(req) as resp:
                if resp.status in (200, 201):
                    success_count += 1
                    print(f"[{idx:02d}/{len(teams)}] Uploaded {doc_id} | PIN: {team['password']} | Team: {team['teamName']}")
        except urllib.error.HTTPError as e:
            fail_count += 1
            error_msg = e.read().decode()
            print(f"[{idx:02d}/{len(teams)}] FAILED {doc_id}: HTTP {e.code} - {error_msg}")
        except Exception as e:
            fail_count += 1
            print(f"[{idx:02d}/{len(teams)}] ERROR {doc_id}: {str(e)}")

    print(f"\n==========================================")
    print(f"Upload Complete!")
    print(f"Successfully uploaded: {success_count}/{len(teams)} teams")
    if fail_count > 0:
        print(f"Failed: {fail_count}")
    print(f"==========================================")

if __name__ == "__main__":
    upload_teams(collection_name="registrations")
