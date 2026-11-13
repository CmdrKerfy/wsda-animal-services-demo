# -*- coding: utf-8 -*-
"""
The HPAI zones tool's rules, in plain Python (no ArcGIS): reading the agreed HPAI table, active or closed on a date,
the zones around each case, the cases table's rows and the check printed at the end. HPAI_Zones.pyt wraps them for
ArcGIS Pro; tests/test_zone_rules.py runs them here on made-up tables.

The rules are the Emergency dashboard's, written again in Python, so both always agree:
    site/emergency/rules.js    readPositives (the columns), dateOf (the dates), isPast (active or closed), kindOf
    site/emergency/report.js   figures (rows detected after the date left out; the counties; the same map point)
    site/shared/proximity.js   destination and circle (the zones' shapes: 360 points on a sphere of 6,378,137 m)
and the HPAI update's counting rules. Where the tool differs, it says so below.

Premises, Address and City are never read: the reader keeps only the columns named in COLUMNS, and skips any column
whose name has "address", "location", "street" or "premise" in it, as the dashboard does.

The agreed choices:
every case with a map point gets its zones; at a map point with more than one case, every case's zones are written,
and the public sees one set (Online_Live 'Yes'): the latest active case's, or with none active the latest closed
case's; closed sites keep their zones; coordinates that cannot be used are named so staff can fix them.
"""

import csv
import io
import math
import re
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP

# ---- The table's columns (types/hpai.js and rules.js COLUMNS; the first name found wins, any capitals) ----------
COLUMNS = {
    'case_id': ['Case ID', 'AnimalDiseaseReportId'],
    'confirmed': ['Confirmed Diagnosis'],
    'reported': ['Date Reported', 'Detection Date'],
    'close_date': ['Close Date'],
    'release': ['Quarantine Release'],
    'status': ['Status', 'Surveillance Closed'],
    'county': ['County'],
    'lat': ['Case Lat', 'Lat', 'Latitude', 'Y'],
    'lon': ['Case Long', 'Long', 'Lon', 'Lng', 'Longitude', 'X'],
    'flock_type': ['Flock/Herd Type'],
    'inventory': ['Flock/Herd Inventory'],
    'species': ['Species', 'Species Group'],
}
PRIVATE = re.compile(r'address|location|street|premise', re.I)
NEVER_READ = re.compile(r'address|location|street|premise|^\s*city\s*$', re.I)
CLOSED_WORDS = ('closed', 'yes', 'y', 'true', '1')

# The cases table: these nine fields only, in this order (what the public cases table holds). The second name is the
# field's name in ArcGIS (a CSV's header as ArcGIS Online names it, and the starter file's).
CASE_FIELDS = [
    ('Confirmed Diagnosis', 'Confirmed_Diagnosis', 'DATE'),
    ('Date Reported', 'Date_Reported', 'DATE'),
    ('Close Date', 'Close_Date', 'DATE'),
    ('Quarantine Release', 'Quarantine_Release', 'DATE'),
    ('Status', 'Status', 'TEXT'),
    ('County', 'County', 'TEXT'),
    ('Flock/Herd Type', 'Flock_Herd_Type', 'TEXT'),
    ('Flock/Herd Inventory', 'Flock_Herd_Inventory', 'LONG'),
    ('Species', 'Species', 'TEXT'),
]

# The zones layer: today's field names, so today's pop-up settings can be copied, without PremiseLoc, Latitude and
# Longitude (the shape is the location). (name, type, length)
ZONE_FIELDS = [
    ('Zone_Type', 'TEXT', 20),
    ('Closed_Site', 'TEXT', 3),
    ('Online_Live', 'TEXT', 3),
    ('Statement1', 'TEXT', 1000),
    ('Statement2', 'TEXT', 1000),
    ('StmtOther', 'TEXT', 1000),
    ('County', 'TEXT', 50),
]
# Fields ArcGIS adds by itself, never checked.
SYSTEM_FIELDS = {'objectid', 'fid', 'oid', 'shape', 'shape_length', 'shape_area', 'shape__length', 'shape__area',
                 'globalid', 'creationdate', 'creator', 'editdate', 'editor'}
# Fields only today's public zones layer has: a layer with any of them is today's, and the tool never writes to it.
TODAYS_FIELDS = {'premiseloc', 'latitude', 'longitude', 'onlinelive', 'closed', 'statement_other'}

ZONE_INFECTION = 'Infection Zone'
ZONE_CONTROL = 'Control Zone'
INFECTION_KM = 3
CONTROL_KM = 10

# The notices, copied unchanged from the inherited tool (HPAI_Mapping_Tools/ArcGIS/HPAI_Mapping_Tools.pyt,
# STATEMENT_ACTIVE and STATEMENT_CLOSED), now written whole: Statement1 is 302 characters.
STATEMENT_OPEN = (
    'You are in a surveillance zone! You can help us close the outbreak by '
    'filling out this survey or calling the number below to let us know your '
    'birds are healthy, fill out this <a href=https://arcg.is/0H4SPm '
    'target="_top">surveillance form</a> or call 1-866-414-0552 to speak to '
    'one of our veterinarians.',
    'To find out more about what it means to be in a surveillance zone, visit '
    'our <a href=https://agr.wa.gov/departments/animals-livestock-and-pets/'
    'avian-health/avian-influenza target="_top">avian influenza webpage.</a>'
)
STATEMENT_CLOSED = ('This site is closed and is no longer under surveillance', None)

# Washington's bounding box (rules.js WA): a pair inside it the other way round is reported as swapped.
WA_BOX = {'south': 45.5, 'north': 49.1, 'west': -124.9, 'east': -116.9}
WA_COUNTIES = ['Adams', 'Asotin', 'Benton', 'Chelan', 'Clallam', 'Clark', 'Columbia', 'Cowlitz', 'Douglas', 'Ferry',
               'Franklin', 'Garfield', 'Grant', 'Grays Harbor', 'Island', 'Jefferson', 'King', 'Kitsap', 'Kittitas',
               'Klickitat', 'Lewis', 'Lincoln', 'Mason', 'Okanogan', 'Pacific', 'Pend Oreille', 'Pierce', 'San Juan',
               'Skagit', 'Skamania', 'Snohomish', 'Spokane', 'Stevens', 'Thurston', 'Wahkiakum', 'Walla Walla',
               'Whatcom', 'Whitman', 'Yakima']
COUNTY_NOT_GIVEN = 'county not given'

# The kinds of animal and their words: a copy of site/emergency/types/hpai.js kinds (change both together; the tests
# check they match). A blank species counts as birds; a species no word names counts as other animals.
KINDS = [
    ('birds', ['flock', 'flocks'], [
        'poultry', 'chicken', 'turkey', 'duck', 'goose', 'geese', 'bird', 'avian', 'layer', 'broiler', 'gamebird',
        'pigeon', 'dove', 'waterfowl', 'fowl', 'peafowl', 'pheasant', 'quail', 'chukar', 'grouse', 'partridge', 'emu',
        'ostrich', 'rhea', 'swan', 'gull', 'hawk', 'eagle', 'owl', 'falcon', 'raptor', 'crow', 'raven', 'magpie',
        'heron', 'egret', 'pelican', 'cormorant', 'songbird', 'parrot', 'finch', 'sparrow', 'hen']),
    ('cattle', ['dairy herd', 'dairy herds'], [
        'cattle', 'dairy', 'bovine', 'cow', 'heifer', 'steer', 'calf', 'calves', 'beef']),
    ('other', ['premises with other animals', 'premises with other animals'], [
        'goat', 'caprine', 'sheep', 'ovine', 'swine', 'hog', 'porcine', 'pig', 'alpaca', 'llama', 'camelid', 'horse',
        'equine', 'mink', 'cat', 'feline', 'dog', 'canine', 'seal', 'sea lion', 'fox', 'raccoon', 'skunk', 'bear',
        'ferret', 'rabbit', 'deer', 'elk', 'wolf', 'dolphin', 'porpoise']),
]

# At most this many lines named for one kind of problem; then "and N more".
LIST_LIMIT = 10


class TableError(Exception):
    """A problem that stops the tool before anything changes."""


# ---- Reading -----------------------------------------------------------------------------------------------------

def text(v):
    return '' if v is None else str(v).strip()


def date_of(v):
    """A date written YYYY-MM-DD, YYYY/M/D or M/D/YYYY (a time after it is ignored), as a date; None otherwise
    (rules.js dateOf)."""
    s = text(v)
    m = re.match(r'^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?$', s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})(?:[ T].*)?$', s)
        if not m:
            return None
        y, mo, d = int(m.group(3)), int(m.group(1)), int(m.group(2))
    try:
        return date(y, mo, d)
    except ValueError:
        return None


def number_of(v):
    """A plain number ("47.25", "-122.1", "1e2"); None otherwise (proximity.js number, without its hex and infinity
    forms, which no coordinate uses)."""
    s = text(v)
    if re.match(r'^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$', s):
        return float(s)
    return None


def inventory_of(v):
    """A whole number of animals, with or without thousands commas; None when blank or unreadable, never zero."""
    s = text(v)
    if re.match(r'^\d+$', s) or re.match(r'^\d{1,3}(,\d{3})+$', s):
        return int(s.replace(',', ''))
    return None


def county_of(v):
    """One of Washington's 39 county names in any capitals, with or without "County"; any other name kept as
    written; None when blank."""
    s = re.sub(r'\s+', ' ', text(v))
    if not s:
        return None
    bare = re.sub(r'\s+county$', '', s, flags=re.I).lower()
    for name in WA_COUNTIES:
        if name.lower() == bare:
            return name
    return s


def has_word(species_lower, word):
    """Where the word starts a word of the text (types.js wordStarts)."""
    out = []
    at = species_lower.find(word)
    while at >= 0:
        if at == 0 or not re.match(r'[a-z0-9]', species_lower[at - 1]):
            out.append(at)
        at = species_lower.find(word, at + 1)
    return out


def kinds_of(species):
    """The kinds of animal a species names, as indices into KINDS (rules.js kindOf): a longer word of another kind
    at the same place wins ("pigeon" is a bird, not a pig)."""
    s = re.sub(r'\s+', ' ', text(species).lower())
    if not s:
        return [0]

    def covered(i, w, at):
        return any(j != i and any(len(f) > len(w) and s.startswith(f, at) for f in KINDS[j][2]) for j in range(len(KINDS)))

    hits = [i for i in range(len(KINDS))
            if any(any(not covered(i, w, at) for at in has_word(s, w)) for w in KINDS[i][2])]
    return hits or [len(KINDS) - 1]


def round5(x):
    """To 5 decimals as JavaScript's toFixed(5) writes it (an exact half away from zero), so "the same map point"
    is the dashboard's (report.js)."""
    return str(Decimal(x).quantize(Decimal('0.00001'), rounding=ROUND_HALF_UP))


def decode(raw):
    """The file's text: UTF-8 (with or without Excel's byte order mark), else Windows' own encoding."""
    try:
        return raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        return raw.decode('cp1252')


class Case(object):
    """One row of the table, as the tool reads it. Never holds Premises, Address or City."""

    def __init__(self, line):
        self.line = line
        self.values = {}       # role -> the cell as written, for the roles in COLUMNS only
        self.case_id = None
        self.confirmed = self.reported = self.close_date = self.release = None
        self.detected = None
        self.closed_flag = False
        self.county = None
        self.lat = self.lon = None
        self.point_problem = None   # why the row has no usable map point, or None
        self.inventory = None
        self.kinds = [0]

    def name(self):
        return 'line ' + str(self.line) + (' (' + self.case_id + ')' if self.case_id else '')

    def key(self):
        return round5(self.lat) + ',' + round5(self.lon)


class Table(object):
    def __init__(self):
        self.header = []
        self.columns = {}      # role -> the header's name for it
        self.never_read = []   # the header's names the tool never reads (Premises, Address, City, ...)
        self.missing = []      # roles not found
        self.cases = []
        self.bad = {}          # problem kind -> [Case]


def read_table(raw):
    """The agreed HPAI table from the file's bytes. Only the columns in COLUMNS are kept; a column whose name has
    "address", "location", "street" or "premise" in it is never matched. Raises TableError for a table the tool
    cannot use."""
    rows = [r for r in csv.reader(io.StringIO(decode(raw)))]
    if not rows:
        raise TableError('The HPAI table is empty.')
    t = Table()
    t.header = [text(h) for h in rows[0]]
    lower = [h.lower() for h in t.header]
    at = {}
    for role, names in COLUMNS.items():
        for n in names:
            if n.lower() in lower and not PRIVATE.search(t.header[lower.index(n.lower())]):
                at[role] = lower.index(n.lower())
                t.columns[role] = t.header[at[role]]
                break
        else:
            t.missing.append(role)
    t.never_read = [h for h in t.header if NEVER_READ.search(h)]
    if 'lat' in t.missing or 'lon' in t.missing:
        raise TableError('The HPAI table has no Latitude or Longitude column.')
    if 'close_date' in t.missing and 'status' in t.missing:
        raise TableError('The HPAI table has neither a Close Date nor a Status column, so every case would be active.')

    def bad(kind, c):
        t.bad.setdefault(kind, []).append(c)

    for i, r in enumerate(rows[1:]):
        if all(text(v) == '' for v in r):
            continue
        c = Case(i + 2)
        for role, k in at.items():
            c.values[role] = text(r[k]) if k < len(r) else ''
        v = c.values.get
        c.case_id = v('case_id') or None
        for role in ('confirmed', 'reported', 'close_date', 'release'):
            d = date_of(v(role))
            setattr(c, role, d)
            if v(role) and d is None:
                bad('date:' + t.columns[role], c)
        c.detected = c.confirmed or (c.reported if not v('confirmed') else None)
        c.closed_flag = text(v('status')).lower() in CLOSED_WORDS
        c.county = county_of(v('county'))
        if c.county and c.county not in WA_COUNTIES:
            bad('county', c)
        c.inventory = inventory_of(v('inventory'))
        if v('inventory') and c.inventory is None:
            bad('inventory', c)
        c.kinds = kinds_of(v('species'))
        lat_t, lon_t = v('lat') or '', v('lon') or ''
        lat, lon = number_of(lat_t), number_of(lon_t)
        if lat is not None and lon is not None and abs(lat) <= 90 and abs(lon) <= 180:
            c.lat, c.lon = lat, lon
            box = WA_BOX
            if not (box['south'] <= lat <= box['north'] and box['west'] <= lon <= box['east']):
                bad('outside', c)
        elif not lat_t and not lon_t:
            c.point_problem = 'no coordinates'
        elif not lat_t:
            c.point_problem = 'no latitude'
        elif not lon_t:
            c.point_problem = 'no longitude'
        elif lat is not None and lon is not None and WA_BOX['south'] <= lon <= WA_BOX['north'] \
                and WA_BOX['west'] <= lat <= WA_BOX['east']:
            c.point_problem = 'latitude and longitude look swapped'
        else:
            c.point_problem = 'coordinates not readable'
        if c.point_problem and c.point_problem != 'no coordinates':
            bad('point', c)
        t.cases.append(c)
    if not t.cases:
        raise TableError('The HPAI table has no rows.')
    return t


# ---- Active or closed --------------------------------------------------------------------------------------------

def is_closed(c, on, today):
    """Closed on the date (rules.js isPast; the update's three rules): its Close Date on or before
    it; else, with Status saying closed, its Quarantine Release on or before it (a release later than today is not
    taken as the day it closed); else closed when Status says so, on any date."""
    if c.close_date:
        return c.close_date <= on
    if c.closed_flag and c.release and not c.release > today:
        return c.release <= on
    return c.closed_flag


# ---- The zones -----------------------------------------------------------------------------------------------------

EARTH_RADIUS_M = 6378137.0


def destination(lat, lon, km, bearing):
    """The point km away along a bearing (degrees from north) on a sphere, as (lon, lat) (proximity.js destination)."""
    d = km * 1000.0 / EARTH_RADIUS_M
    p1, l1, b = math.radians(lat), math.radians(lon), math.radians(bearing)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(b))
    l2 = l1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return (((math.degrees(l2) + 540) % 360) - 180, math.degrees(p2))


def circle(lat, lon, km, steps=360):
    """A closed ring of points at the distance around the center, clockwise from north (proximity.js circle)."""
    ring = [destination(lat, lon, km, 360.0 * i / steps) for i in range(steps)]
    return ring + [ring[0]]


def zone_rings(c, zone_type):
    """A zone's rings as (lon, lat) lists: the infection zone one 3 km ring; the control zone the 10 km ring with
    the 3 km ring as its hole (counterclockwise, as ArcGIS writes a hole)."""
    inner = circle(c.lat, c.lon, INFECTION_KM)
    if zone_type == ZONE_INFECTION:
        return [inner]
    return [circle(c.lat, c.lon, CONTROL_KM), list(reversed(inner))]


class Result(object):
    pass


def later(a, b):
    """Whether case a is later than case b: by detection date (none is earliest), then by line."""
    return (a.detected or date.min, a.line) > (b.detected or date.min, b.line)


def build(table, on, today, statement_other=None):
    """Everything the tool writes and prints, worked out from the table on the date `on` (today unless a past update
    is checked). Nothing here touches ArcGIS."""
    res = Result()
    res.on, res.today = on, today
    res.later = [c for c in table.cases if c.detected and c.detected > on]
    res.after_today = [c for c in table.cases if c.detected and c.detected > today]
    res.release_after_today = [c for c in table.cases if c.release and c.release > today and not c.close_date and c.closed_flag]
    rows = [c for c in table.cases if not (c.detected and c.detected > on)]
    res.rows = rows
    res.undated = [c for c in rows if not c.detected]
    res.active = [c for c in rows if not is_closed(c, on, today)]
    res.closed_day_unknown = [c for c in rows if c.closed_flag and not c.close_date and (not c.release or c.release > today)]
    res.no_point = [c for c in rows if c.lat is None]

    # One public set per map point: the latest active case's, or with none active the latest closed case's.
    active_ids = set(id(c) for c in res.active)
    points = {}
    for c in rows:
        if c.lat is not None:
            points.setdefault(c.key(), []).append(c)
    shown = set()
    for cases in points.values():
        pool = [c for c in cases if id(c) in active_ids] or cases
        best = pool[0]
        for c in pool[1:]:
            if later(c, best):
                best = c
        shown.add(id(best))
    res.points = points
    res.shared = [cases for cases in points.values() if len(cases) > 1]
    res.open_points = [k for k, cases in points.items() if any(id(c) in active_ids for c in cases)]

    other = (statement_other or '').strip() or None
    res.zones = []
    for c in rows:
        if c.lat is None:
            continue
        open_ = id(c) in active_ids
        s1, s2 = STATEMENT_OPEN if open_ else STATEMENT_CLOSED
        for zone_type in (ZONE_INFECTION, ZONE_CONTROL):
            res.zones.append({'case': c, 'rings': zone_rings(c, zone_type), 'attributes': {
                'Zone_Type': zone_type, 'Closed_Site': 'No' if open_ else 'Yes',
                'Online_Live': 'Yes' if id(c) in shown else 'No', 'Statement1': s1, 'Statement2': s2,
                'StmtOther': other, 'County': c.county}})

    # The figures the check prints (report.js figures on the same rows).
    res.counties = sorted(set(c.county for c in rows if c.county in WA_COUNTIES))
    zoned = [c for c in res.active if c.lat is not None]
    res.area_counties = sorted(set(c.county or COUNTY_NOT_GIVEN for c in zoned))
    res.zoned_active = zoned
    res.active_by_kind = [sum(1 for c in res.active if k in c.kinds) for k in range(len(KINDS))]
    return res


def case_rows(table, today):
    """The cases table's rows: every row of the table (the update counts rows without a point too) but those detected
    after today (a date typed wrongly; the check lists them to fix), the nine fields only, dates as dates at midday
    (so no time zone moves them to the day before). A row detected after a past date checked stays: the dashboard
    counts by date."""
    out = []
    for c in table.cases:
        if c.detected and c.detected > today:
            continue
        v = c.values.get
        row = []
        for label, _, kind in CASE_FIELDS:
            if kind == 'DATE':
                role = {'Confirmed Diagnosis': 'confirmed', 'Date Reported': 'reported', 'Close Date': 'close_date',
                        'Quarantine Release': 'release'}[label]
                d = getattr(c, role)
                row.append(datetime(d.year, d.month, d.day, 12) if d else None)
            elif kind == 'LONG':
                row.append(c.inventory)
            else:
                role = {'Status': 'status', 'County': 'county', 'Flock/Herd Type': 'flock_type', 'Species': 'species'}[label]
                row.append(v(role) or None)
        out.append(row)
    return out


def safe_cell(v):
    """A cell as a spreadsheet opens it safely: one starting with =, +, -, @, a tab or a carriage return would be read
    as a formula, so it gets a single quote before it."""
    return "'" + v if v[:1] in ('=', '+', '-', '@', '\t', '\r') else v


def cases_csv(table, today):
    """hpai-cases-public.csv: the cases table's rows as a file, for a first upload (dates as M/D/YYYY)."""
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator='\r\n')
    w.writerow([label for label, _, _ in CASE_FIELDS])
    for row in case_rows(table, today):
        w.writerow(['' if v is None else (str(v.month) + '/' + str(v.day) + '/' + str(v.year)) if isinstance(v, datetime)
                    else safe_cell(str(v)) for v in row])
    return buf.getvalue()


# ---- Checking the layers before anything is written ----------------------------------------------------------------

def check_zone_fields(fields):
    """Problems with the zones layer, from its fields as (name, type, length): [] when the tool may write to it.
    Today's public zones layer is refused by its own fields, so the tool can never change it."""
    names = {n.lower(): (n, t, ln) for n, t, ln in fields}
    if TODAYS_FIELDS & set(names):
        return ['This looks like today\'s public zones layer; the tool writes only to the new HPAI zones layer '
                '(made from the starter file). Nothing changed.']
    out = []
    for name, kind, length in ZONE_FIELDS:
        f = names.get(name.lower())
        if not f:
            out.append('The zones layer has no ' + name + ' field.')
        elif kind == 'TEXT' and f[1] not in ('String', 'TEXT'):
            out.append('The zones layer\'s ' + name + ' field is not a text field.')
    need = {'Statement1': len(STATEMENT_OPEN[0]), 'Statement2': len(STATEMENT_OPEN[1])}
    for name, n in need.items():
        f = names.get(name.lower())
        if f and f[2] and f[2] < n:
            out.append('The zones layer\'s ' + name + ' field holds ' + str(f[2]) + ' characters; the notice is ' + str(n) + '.')
    extra = sorted(n for k, (n, _, _) in names.items() if k not in SYSTEM_FIELDS and k not in [z[0].lower() for z in ZONE_FIELDS])
    if extra:
        out.append('The zones layer has fields the new zones layer does not: ' + ', '.join(extra) + '.')
    return out


def norm(name):
    return re.sub(r'[^a-z0-9]', '', name.lower())


def check_case_fields(fields):
    """Problems with the cases table, from its fields as (name, type, length), and the field each of the nine is
    written to: (problems, [field name per CASE_FIELDS])."""
    names = {norm(n): (n, t, ln) for n, t, ln in fields}
    out, target = [], []
    for label, arc_name, kind in CASE_FIELDS:
        f = names.get(norm(arc_name))
        if not f:
            out.append('The cases table has no field for ' + label + ' (looked for ' + arc_name + ').')
            target.append(None)
            continue
        target.append(f[0])
        if kind == 'DATE' and f[1] not in ('Date', 'DateOnly'):
            out.append('The cases table\'s ' + f[0] + ' field is a ' + f[1] + ' field; it must be a Date field '
                       '(the dashboard counts its dates).')
        if kind == 'LONG' and f[1] not in ('Integer', 'SmallInteger', 'BigInteger', 'Double', 'Single'):
            out.append('The cases table\'s ' + f[0] + ' field is not a number field.')
    wanted = set(norm(a) for _, a, _ in CASE_FIELDS)
    extra = sorted(n for k, (n, _, _) in names.items() if k not in wanted and k not in SYSTEM_FIELDS)
    if extra:
        out.append('The cases table has fields beyond the nine: ' + ', '.join(extra) + '. Make it from the starter '
                   'file or hpai-cases-public.csv, so nothing else of the table reaches ArcGIS Online.')
    return out, target


# ---- The check ---------------------------------------------------------------------------------------------------

def long_date(d):
    return d.strftime('%B ') + str(d.day) + d.strftime(', %Y')


def named(cases):
    """The cases' names, the first LIST_LIMIT, then how many more."""
    names = [c.name() for c in cases[:LIST_LIMIT]]
    more = len(cases) - LIST_LIMIT
    return ', '.join(names) + (', and ' + str(more) + ' more' if more > 0 else '')


def plural(n, one, many):
    return str(n) + ' ' + (one if n == 1 else many)


def to_fix(table, res):
    """The rows staff should fix in the table, one line each: (what, [Case])."""
    out = []
    points = table.bad.get('point', [])
    for why in ('latitude and longitude look swapped', 'coordinates not readable', 'no latitude', 'no longitude'):
        cases = [c for c in points if c.point_problem == why]
        if cases:
            out.append(('Coordinates: ' + why + ', no zones until fixed', cases))
    if table.bad.get('outside'):
        out.append(('Coordinates outside Washington (zones drawn; check them)', table.bad['outside']))
    for kind in sorted(k for k in table.bad if k.startswith('date:')):
        out.append(('A date that could not be read in ' + kind[5:] + ' (counted as blank)', table.bad[kind]))
    if res.after_today:
        out.append(('Detected after today (left out; check the date)', res.after_today))
    if res.release_after_today:
        out.append(('A Quarantine Release later than today (not taken as the day closed)', res.release_after_today))
    if table.bad.get('county'):
        out.append(('A County that is not one of Washington\'s 39 (counted as written; a typing slip?)', table.bad['county']))
    if table.bad.get('inventory'):
        out.append(('A Flock/Herd Inventory that is not a whole number (left blank)', table.bad['inventory']))
    return out


def point_warnings(table):
    """One line for the tool's window as soon as the table is picked, naming the rows whose coordinates cannot be
    used; '' when there are none."""
    cases = table.bad.get('point', [])
    if not cases:
        return ''
    return plural(len(cases), 'row has', 'rows have') + ' coordinates to fix: ' + named(cases) + '.'


def check_lines(table, res, check_only):
    """The check, as (level, text) lines: level 'info' or 'warning' (ArcGIS Pro shows warnings in yellow). One
    ('steps', None) line marks where the toolbox says steps 4 and 5 (the writing), as they happen."""
    out = []
    say = lambda t, level='info': out.append((level, t))
    say('HPAI ZONES TOOL, ' + long_date(res.on) + (' (CHECK ONLY: nothing is written)' if check_only else ''))
    say('=' * 50)
    say('[1/5] Reading the HPAI table')
    say('      ' + plural(len(table.cases), 'row', 'rows') + '. Read: ' + ', '.join(table.columns.values()) + '.')
    if table.never_read:
        say('      Never read: ' + ', '.join(table.never_read) + '.')
    for role in table.missing:
        if role not in ('case_id',):
            say('      Not found: ' + COLUMNS[role][0] + '.', 'warning')
    say('[2/5] Active or closed on ' + long_date(res.on) + ' (the Emergency dashboard\'s rules)')
    say('      ' + plural(len(res.rows), 'case', 'cases') + '.' + (' ' + plural(len(res.later), 'row', 'rows') +
        ' detected after ' + long_date(res.on) + ' left out: ' + named(res.later) + '.' if res.later else ''))
    say('      ' + str(len(res.active)) + ' active, ' + str(len(res.rows) - len(res.active)) + ' closed.')
    if res.undated:
        say('      ' + plural(len(res.undated), 'case', 'cases') + ' without a readable detection date, counted in no '
            'month: ' + named(res.undated) + '.')
    if res.closed_day_unknown:
        say('      ' + plural(len(res.closed_day_unknown), 'case', 'cases') + ' closed by Status alone, the day closed '
            'not known: ' + named(res.closed_day_unknown) + '.')
    say('[3/5] The zones (3 km infection zone, 3 to 10 km control ring, around each case\'s map point)')
    zoned = [c for c in res.rows if c.lat is not None]
    say('      ' + plural(len(zoned), 'case', 'cases') + ' with a map point: ' + str(len(res.zones)) + ' zones, at ' +
        plural(len(res.points), 'map point', 'map points') + ' (' + str(len(res.open_points)) + ' open).')
    if res.no_point:
        say('      ' + plural(len(res.no_point), 'case has', 'cases have') + ' no map point and get no zones: ' +
            named(res.no_point) + '.')
    if res.shared:
        say('      ' + plural(len(res.shared), 'map point has', 'map points have') + ' more than one case: every case\'s '
            'zones written, the public sees one set (the latest active case\'s, or the latest closed one\'s):')
        for cases in res.shared[:LIST_LIMIT]:
            say('        ' + named(cases))
        if len(res.shared) > LIST_LIMIT:
            say('        and ' + str(len(res.shared) - LIST_LIMIT) + ' more')
    say('      The open sites\' notice: ' + str(len(STATEMENT_OPEN[0])) + ' characters, written whole.')
    fixes = to_fix(table, res)
    kinds = [plural(n, KINDS[k][1][0], KINDS[k][1][1]) for k, n in enumerate(res.active_by_kind) if n]
    out.append(('steps', None))   # steps 4 and 5 are said by the toolbox, where they happen
    say('THE CHECK (compare with the update)')
    say('  Cases ............................ ' + str(len(res.rows)))
    say('  Active ........................... ' + str(len(res.active)) + ('   (' + ', '.join(kinds) + ')' if kinds else ''))
    say('  Counties affected ................ ' + str(len(res.counties)) + '   (Washington\'s)')
    say('  Active surveillance areas ........ ' + str(len(res.zoned_active)) + ' (active cases with a map point), in ' +
        plural(len(res.area_counties), 'county', 'counties') + (' (' + ', '.join(res.area_counties) + ')' if res.area_counties else ''))
    if fixes:
        say('TO FIX IN THE TABLE (' + plural(sum(len(c) for _, c in fixes), 'row', 'rows') + ')', 'warning')
        for what, cases in fixes:
            say('  ' + what + ': ' + named(cases) + '.', 'warning')
    return out
