import zipfile
import xml.etree.ElementTree as ET
import re
import random
import json
import csv

# Reproducible random seed
random.seed(2026)

# Read Participants.xlsx supporting both sharedStrings and inlineStr
with zipfile.ZipFile('Participants.xlsx', 'r') as z:
    shared_strings = []
    if 'xl/sharedStrings.xml' in z.namelist():
        tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
        ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        for si in tree.findall('.//ns:si', ns):
            texts = [t.text for t in si.findall('.//ns:t', ns) if t.text]
            shared_strings.append(''.join(texts))

    sheet_tree = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    rows = []
    for row in sheet_tree.findall('.//ns:row', ns):
        row_vals = []
        for c in row.findall('ns:c', ns):
            t_type = c.attrib.get('t')
            if t_type == 's':
                v = c.find('ns:v', ns)
                idx = int(v.text) if v is not None and v.text else 0
                val = shared_strings[idx] if idx < len(shared_strings) else ''
            elif t_type == 'inlineStr':
                t_el = c.find('.//ns:t', ns)
                val = t_el.text if t_el is not None else ''
            else:
                v = c.find('ns:v', ns)
                val = v.text if v is not None and v.text else ''
            row_vals.append(val.strip() if val else '')
        if any(row_vals):
            rows.append(row_vals)

data = rows[1:] # skip header

teams = []
used_pins = set()

for i, r in enumerate(data, 1):
    raw_id = r[0] if len(r) > 0 else f'TEAM-{i:03d}'
    team_name = r[1] if len(r) > 1 else 'Team'
    leader = r[2] if len(r) > 2 else ''
    members = r[3] if len(r) > 3 else ''

    # Handle row with swapped leader/team name (Row 33: Mahavidyasree.K / Trivexa)
    if team_name == 'Mahavidyasree.K' and leader == 'Trivexa':
        team_name, leader = leader, team_name

    # Create punchy creative slug
    name_clean = re.sub(r'^(TEAM|THE)\s+', '', team_name, flags=re.IGNORECASE).strip()
    if not name_clean:
        name_clean = team_name

    words = re.findall(r'[A-Za-z0-9]+', name_clean)
    if len(words) == 1:
        slug = words[0].upper()[:10]
    elif len(words) >= 2:
        joined = "".join(words).upper()
        if len(joined) <= 10:
            slug = joined
        else:
            slug = words[-1].upper()[:10] if len(words[-1]) >= 4 else words[0].upper()[:10]
    else:
        slug = f"SQUAD{i}"

    # Extract original number
    num_match = re.search(r'\d+', raw_id)
    num_str = f'{int(num_match.group()):03d}' if num_match else f'{i:03d}'

    # Creative Team ID: PRMT-<NUM>-<SLUG>
    creative_id = f'PRMT-{num_str}-{slug}'

    # Simple 4-digit unique PIN (No symbols, no uppercase, no confusion)
    while True:
        pin = f"{random.randint(1000, 9999)}"
        if pin not in used_pins:
            used_pins.add(pin)
            break

    password = pin

    teams.append({
        'originalId': raw_id,
        'teamId': creative_id,
        'teamName': team_name,
        'leaderName': leader,
        'participants': members,
        'password': password
    })

# Save as JSON
with open('teams-credentials.json', 'w', encoding='utf-8') as f:
    json.dump(teams, f, indent=2)

# Save as CSV
with open('Promptathon_Teams_Credentials.csv', 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f)
    writer.writerow(['Original ID', 'Creative Team ID', 'Team Name', 'Team Leader', 'Participants', 'Password (PIN)'])
    for t in teams:
        writer.writerow([t['originalId'], t['teamId'], t['teamName'], t['leaderName'], t['participants'], t['password']])

print(f'Successfully generated {len(teams)} team credentials with simple 4-digit PINs.')
