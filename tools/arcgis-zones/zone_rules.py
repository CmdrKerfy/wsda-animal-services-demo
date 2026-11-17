# -*- coding: utf-8 -*-
"""
The HPAI zones tool's rules, in plain Python (no ArcGIS): reading the agreed HPAI table, active or closed on a date,
the zones around each case, the cases table's rows and the check printed at the end. HPAI_Zones.pyt wraps them for
ArcGIS Pro; tests/test_zone_rules.py runs them here on made-up tables.

The rules are the Emergency dashboard's, written again in Python, so both always agree:
    site/emergency/rules.js    readPositives (the columns), dateOf (the dates), isPast (active or closed), kindOf
    site/emergency/report.js   figures (rows detected after the date left out; the counties; the same map point)
    site/shared/proximity.js   destination and circle (the zones' shapes: 360 points on a sphere of 6,378,137 m)
and the HPAI update's counting rules. Where the tool differs, it says so below: a point with a minus sign missing or
extra, or a coordinate of exactly 0, gets no zones here (the dashboard draws it until 2.9.2).

Premises, Address and City are never kept, written or shown: the reader keeps only the columns named in COLUMNS, and
skips any column whose name has "address", "location", "street" or "premise" in it, as the dashboard does. (Every cell
of a row is only tested for a stray quote mark, never kept.)

The agreed choices:
every case with a map point gets its zones; the public sees only the animals in PUBLIC_ANIMALS (birds, for now): at
each map point one set (Online_Live 'Yes'), among the cases there of an animal the public sees, the latest active
case's, or with none active the latest closed case's (a point with no such case shows nothing), and the cases table
holds only the rows of an animal the public sees; each zone's Animal says its case's kinds (a blank Species is birds),
for staff; closed sites keep their zones; coordinates that cannot be used are named so staff can fix them.
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
    'quarantine_status': ['Quarantine Status'],
    'status': ['Status', 'Surveillance Closed'],
    'county': ['County'],
    'state': ['State'],
    'lat': ['Case Lat', 'Lat', 'Latitude', 'Y'],
    'lon': ['Case Long', 'Long', 'Lon', 'Lng', 'Longitude', 'X'],
    'flock_type': ['Flock/Herd Type'],
    'inventory': ['Flock/Herd Inventory'],
    'species': ['Species', 'Species Group'],
    'production_type': ['Production Type'],   # read only to check a blank Species (never written or shown)
}
PRIVATE = re.compile(r'address|location|street|premise', re.I)
NEVER_READ = re.compile(r'address|location|street|premise|^\s*city\s*$', re.I)
CLOSED_WORDS = ('closed', 'yes', 'y', 'true', '1')

# The cases table: these eleven fields only, in this order (what the public cases table holds; Quarantine Status and
# State added in 2.9.1, the table's new format). The second name is the
# field's name in ArcGIS (a CSV's header as ArcGIS Online names it, and the starter file's).
CASE_FIELDS = [
    ('Confirmed Diagnosis', 'Confirmed_Diagnosis', 'DATE'),
    ('Date Reported', 'Date_Reported', 'DATE'),
    ('Close Date', 'Close_Date', 'DATE'),
    ('Quarantine Release', 'Quarantine_Release', 'DATE'),
    ('Quarantine Status', 'Quarantine_Status', 'TEXT'),
    ('Status', 'Status', 'TEXT'),
    ('County', 'County', 'TEXT'),
    ('State', 'State', 'TEXT'),
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
    ('Animal', 'TEXT', 100),   # 2.9.1: the kinds of animal, for staff (the public view leaves it out)
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
# The State column's words for Washington (any capitals, spaces as one); another state is listed to fix, a blank one
# is not.
WA_STATE = ('wa', 'washington', 'washington state')
# The Quarantine Status column's words (site/emergency/types.js QUARANTINE_VALUES; any capitals); any other is listed
# to fix, as the dashboard's "quarantine status not read".
QUARANTINE_WORDS = ('under quarantine', 'quarantined', 'in quarantine', 'released', 'lifted')

# The kinds of animal and their words: a copy of site/emergency/types/hpai.js kinds (change both together; the tests
# check they match). A blank species counts as birds; a species no word names counts as other animals.
KINDS = [
    ('birds', ['flock', 'flocks'], [
        'poultry', 'chicken', 'turkey', 'duck', 'goose', 'geese', 'bird', 'avian', 'layer', 'broiler', 'gamebird',
        'pigeon', 'dove', 'waterfowl', 'fowl', 'peafowl', 'pheasant', 'quail', 'chukar', 'grouse', 'partridge', 'emu',
        'ostrich', 'rhea', 'swan', 'gull', 'hawk', 'eagle', 'owl', 'falcon', 'raptor', 'crow', 'raven', 'magpie',
        'heron', 'egret', 'pelican', 'cormorant', 'songbird', 'parrot', 'finch', 'sparrow', 'hen', 'chick', 'rooster',
        'pullet', 'bantam', 'peacock', 'peahen', 'guineafowl', 'mallard', 'muscovy', 'squab', 'ratite', 'bobwhite',
        'flock', 'seagull', 'blackbird', 'waterbird', 'goshawk', 'cowbird', 'catbird', 'gosling', 'duckling', 'poult']),
    ('cattle', ['dairy herd', 'dairy herds'], [
        'cattle', 'dairy', 'bovine', 'cow', 'heifer', 'steer', 'calf', 'calves', 'beef', 'holstein', 'angus', 'hereford']),
    ('other', ['premises with other animals', 'premises with other animals'], [
        'goat', 'caprine', 'sheep', 'ovine', 'swine', 'hog', 'porcine', 'pig', 'alpaca', 'llama', 'camelid', 'horse',
        'equine', 'mink', 'cat', 'feline', 'dog', 'canine', 'seal', 'sea lion', 'fox', 'raccoon', 'skunk', 'bear',
        'ferret', 'rabbit', 'deer', 'elk', 'wolf', 'dolphin', 'porpoise']),
]

# Weak words, by kind: some of its words that name it only when no other word names a kind ("Backyard flock" is
# birds, "Sheep flock" other animals only); hpai.js's "weak" (change both together).
WEAK_WORDS = {'birds': ('flock',)}

# The Animal field's words for the kinds, in KINDS' order; a case of two kinds is both, joined: "Birds, Cattle".
ANIMAL_NAMES = ('Birds', 'Cattle', 'Other animals')

# ---- WHICH ANIMALS THE PUBLIC SEES (2.9.1: birds only, for now) ----------------------------------------------------
# The kinds (KINDS' first words) whose zones go on the public map and whose rows go in the public cases table. Every
# case's zones are written all the same, for staff. To show cattle too: ('birds', 'cattle'), then copy the tool to the
# work PC again and run it (README.txt, "Showing other animals").
PUBLIC_ANIMALS = ('birds',)

# Written in Species when it is not known yet: counted as blank (birds) and listed with the blanks. Compared as a
# whole with everything but letters and digits taken out, so "N/A", "T.B.D.", "Unknown?", "Not known", "-" and "?"
# are all blank, "Unknown cattle" is not (rules.js BLANK_SPECIES keeps a copy).
BLANK_SPECIES = ('unknown', 'na', 'tbd', 'unknownspecies', 'speciesunknown', 'notknown', 'unk')

# Words a Species may hold besides animal words, not listed to check (2.9.1): any other word, such as a
# farm's name or a place ("Swanson Farms", "Crowley Ranch"), is listed, as it goes public as written.
SPECIES_FILLERS = ('multiple', 'mixed', 'species', 'backyard', 'commercial', 'domestic', 'wild', 'and', 'or', 'other',
                   'with', 'of', 'the', 'a', 'meat', 'egg', 'eggs', 'table', 'breeder', 'breeders', 'upland', 'game',
                   'pet', 'pets', 'hobby', 'exotic', 'captive', 'racing', 'laying', 'adult', 'adults', 'juvenile',
                   'young', 'baby', 'babies', 'market', 'live', 'show', 'unknown', 'herd', 'herds', 'flocks',
                   'premises', 'animal', 'animals', 'guinea', 'pea', 'water')

# At most this many lines named for one kind of problem; then "and N more".
LIST_LIMIT = 10

# What to tell staff when a date or the file itself cannot be read.
DATE_HELP = 'Write dates as M/D/YYYY (3/10/2022) or YYYY-MM-DD (2022-03-10).'
SAVE_HELP = 'In Excel: File > Save As > "CSV UTF-8 (Comma delimited) (*.csv)", then pick that file.'
# A coordinate written with fewer decimals than this may have been rounded by Excel (4 decimals is about 10 meters).
MIN_DECIMALS = 4
# Points that are typing slips, not places: no zones, listed to fix (not the same as no coordinates).
SIGN_SLIP = 'a minus sign missing or extra (122.3 for -122.3?)'
ZERO_POINT = 'a coordinate of 0 (a blank filled with zero?)'
# Species, Status and Flock/Herd Type go public as written: a longer one may hold a name or an address.
LONG_TEXT = 40
# The largest whole number each kind of ArcGIS number field holds.
FIELD_MAX = {'SmallInteger': 32767, 'Integer': 2147483647}


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


def species_blank(species):
    """Whether a Species is blank, or a placeholder for one (BLANK_SPECIES)."""
    s = re.sub(r'[^a-z0-9]', '', text(species).lower())
    return s == '' or s in BLANK_SPECIES


def kinds_of(species):
    """The kinds of animal a species names, as indices into KINDS (rules.js kindOf): a blank species (or a
    placeholder) is birds, one no word names is other animals."""
    if species_blank(species):
        return [0]
    return kinds_named(species) or [len(KINDS) - 1]


def kinds_named(species):
    """The kinds a species' words name, as indices into KINDS; [] when no word does. A longer word of another kind
    at the same place wins ("pigeon" is a bird, not a pig). A weak word (WEAK_WORDS) counts only when no other word
    names a kind ("Sheep flock" is other animals)."""
    s = re.sub(r'\s+', ' ', text(species).lower())

    def covered(i, w, at):
        return any(j != i and any(len(f) > len(w) and s.startswith(f, at) for f in KINDS[j][2]) for j in range(len(KINDS)))

    def named(weak):
        return [i for i in range(len(KINDS))
                if any((w in WEAK_WORDS.get(KINDS[i][0], ())) == weak and any(not covered(i, w, at) for at in has_word(s, w))
                       for w in KINDS[i][2])]

    return named(False) or named(True)


def odd_species_words(species):
    """The words of a Species that are neither an animal word (or one with up to two more letters: "Chickens",
    "Turkeys") nor a filler (SPECIES_FILLERS): [] when none. "Swanson" is one: four letters past "swan"."""
    s = re.sub(r'\s+', ' ', text(species).lower()).replace('sea lion', 'sealion')
    words = [w for _, _, ws in KINDS for w in ws] + ['sealion']
    return [t for t in re.findall(r'[a-z0-9]+', s)
            if t not in SPECIES_FILLERS and not any(t.startswith(w) and len(t) - len(w) <= 2 for w in words)]


def other_animal_type(c):
    """The Flock/Herd Type or Production Type, as typed, when it names an animal other than birds and no bird
    ("Commercial Dairy"), or None."""
    for role in ('flock_type', 'production_type'):
        k = kinds_named(c.values.get(role))
        if k and 0 not in k:
            return c.values.get(role)
    return None


def animal_of(c):
    """The case's Animal field: its kinds' words, joined ("Birds", "Birds, Cattle")."""
    return ', '.join(ANIMAL_NAMES[k] for k in sorted(c.kinds))


def is_public_kind(k):
    return isinstance(PUBLIC_ANIMALS, (tuple, list)) and KINDS[k][0] in PUBLIC_ANIMALS


def is_public(c):
    """Whether the public sees the case: one of its kinds is in PUBLIC_ANIMALS ("Cattle, Chicken" is, as birds)."""
    return any(is_public_kind(k) for k in c.kinds)


def public_words():
    """The animals the public sees, for the check: "birds", "birds and cattle"."""
    return ' and '.join(ANIMAL_NAMES[k].lower() for k in range(len(KINDS)) if is_public_kind(k))


def all_public():
    return all(is_public_kind(k) for k in range(len(KINDS)))


def public_setting_problem():
    """Why PUBLIC_ANIMALS cannot be used, or None: it must be a list of KINDS' first words, at least one. A typing slip
    ('bird', 'Birds') or an empty list would leave the public map empty."""
    keys = [k for k, _, _ in KINDS]
    if not isinstance(PUBLIC_ANIMALS, (tuple, list)) or not PUBLIC_ANIMALS or any(a not in keys for a in PUBLIC_ANIMALS):
        return ('The tool\'s setting PUBLIC_ANIMALS in zone_rules.py is ' + repr(PUBLIC_ANIMALS) + ': it must list one or '
                'more of ' + ', '.join(repr(k) for k in keys) + ', as (\'birds\',). Ask whoever looks after the tool.')
    return None


def round5(x):
    """To 5 decimals as JavaScript's toFixed(5) writes it (an exact half away from zero), so "the same map point"
    is the dashboard's (report.js)."""
    return str(Decimal(x).quantize(Decimal('0.00001'), rounding=ROUND_HALF_UP))


def decode(raw):
    """The file's text: UTF-16 by its byte order mark (Excel's "Unicode Text"), UTF-8 (with or without Excel's byte
    order mark), else Windows' own encoding; TableError when none of them reads it."""
    try:
        if raw[:2] in (b'\xff\xfe', b'\xfe\xff'):
            return raw.decode('utf-16')
        try:
            return raw.decode('utf-8-sig')
        except UnicodeDecodeError:
            return raw.decode('cp1252')
    except UnicodeDecodeError:
        raise TableError('The HPAI table could not be read (its characters are in an encoding the tool does not '
                         'know). ' + SAVE_HELP)


def decimals(s):
    """How many digits a written number has after its decimal point (0 for "47" or "4.7e1")."""
    m = re.match(r'^[+-]?\d*\.(\d+)$', s)
    return len(m.group(1)) if m else 0


def sign_slip(lat, lon):
    """Whether the point falls in Washington once a minus sign is put in or taken out (122.3 for -122.3)."""
    b = WA_BOX
    return any(b['south'] <= y <= b['north'] and b['west'] <= x <= b['east']
               for y, x in ((lat, -lon), (-lat, lon), (-lat, -lon)))


class Case(object):
    """One row of the table, as the tool reads it. Never holds Premises, Address or City."""

    def __init__(self, line):
        self.line = line           # the row's number in Excel (the header is row 1)
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
        self.other_type = None      # the type that names another animal, for a blank Species

    def name(self):
        return 'row ' + str(self.line) + (' (' + self.case_id + ')' if self.case_id else '')

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
    try:
        # newline='': the reader itself takes CRLF, LF or CR alone (an old Mac's) as a line's end.
        rows = [r for r in csv.reader(io.StringIO(decode(raw), newline=''))]
    except csv.Error as e:
        raise TableError('The HPAI table could not be read as a CSV file (' + str(e) + '). ' + SAVE_HELP)
    if not rows:
        raise TableError('The HPAI table is empty.')
    if len(rows[0]) == 1 and '\t' in rows[0][0]:
        raise TableError('The HPAI table is separated by tabs (Excel\'s "Unicode Text"?), not commas. ' + SAVE_HELP)
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
        raise TableError('The HPAI table has no Latitude or Longitude column. Check that the file picked is the HPAI '
                         'table, and the two headings\' spelling.')
    if 'close_date' in t.missing and 'status' in t.missing:
        raise TableError('The HPAI table has neither a Close Date nor a Status column, so every case would be active. '
                         'Check that the file picked is the HPAI table, and the headings\' spelling.')

    def bad(kind, c):
        t.bad.setdefault(kind, []).append(c)

    for i, r in enumerate(rows[1:]):
        if all(text(v) == '' for v in r):
            continue
        c = Case(i + 2)
        for role, k in at.items():
            c.values[role] = text(r[k]) if k < len(r) else ''
        # A stray quote mark, in any column (read or not), makes the reader take the next rows into one cell: a cell
        # holding line breaks and many commas. Only tested, never kept.
        if any(('\n' in x or '\r' in x) and x.count(',') >= max(3, len(t.header) // 2) for x in r):
            bad('quotes', c)
        for role in ('species', 'status', 'flock_type'):
            if len(c.values.get(role) or '') > LONG_TEXT:
                bad('long_text', c)
                break
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
        if v('state') and re.sub(r'\s+', ' ', text(v('state'))).lower() not in WA_STATE:
            bad('state', c)
        # As the dashboard reads it (types.js quarantineStatusOf): the ends trimmed, any capitals, nothing else.
        if v('quarantine_status') and text(v('quarantine_status')).lower() not in QUARANTINE_WORDS:
            bad('quarantine_status', c)
        c.inventory = inventory_of(v('inventory'))
        if v('inventory') and c.inventory is None:
            bad('inventory', c)
        c.kinds = kinds_of(v('species'))
        # Listed so staff fill them in or check them: a blank Species (or a placeholder) counts as birds, so goes on
        # the public map; one no word names counts as other animals (so a typing slip would take a flock off it); one
        # naming two kinds counts as each (a farm's name, "Sample Eagle Dairy", would put a dairy on it).
        if 'species' in t.columns:
            named_kinds = kinds_named(v('species'))
            if species_blank(v('species')) and other_animal_type(c):
                # A dairy (say) with no Species would go on the public map as birds: a real run stops.
                c.other_type = other_animal_type(c)
                bad('species_blank_other', c)
            elif species_blank(v('species')):
                bad('species_blank', c)
            elif len(named_kinds) > 1:
                bad('species_mixed', c)
            elif not named_kinds:
                bad('species_unknown', c)
            if named_kinds and odd_species_words(v('species')):
                bad('species_words', c)
        # A digit in Species or Flock/Herd Type: an address or a phone number? Both go public as written (a
        # real run stops).
        if any(re.search(r'\d', v(role) or '') for role in ('species', 'flock_type')):
            bad('digits', c)
        lat_t, lon_t = v('lat') or '', v('lon') or ''
        lat, lon = number_of(lat_t), number_of(lon_t)
        box = WA_BOX
        inside = lat is not None and lon is not None and \
            box['south'] <= lat <= box['north'] and box['west'] <= lon <= box['east']
        if lat == 0 or lon == 0:
            c.point_problem = ZERO_POINT
        elif lat is not None and lon is not None and not inside and sign_slip(lat, lon):
            c.point_problem = SIGN_SLIP
        elif lat is not None and lon is not None and abs(lat) <= 90 and abs(lon) <= 180:
            c.lat, c.lon = lat, lon
            if not inside:
                bad('outside', c)
            if 'e' not in (lat_t + lon_t).lower() and min(decimals(lat_t), decimals(lon_t)) < MIN_DECIMALS:
                bad('decimals', c)
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

    # One public set per map point, among the cases there of an animal the public sees (PUBLIC_ANIMALS): the latest
    # active case's, or with none active the latest closed case's; a point with no such case shows nothing.
    active_ids = set(id(c) for c in res.active)
    points = {}
    for c in rows:
        if c.lat is not None:
            points.setdefault(c.key(), []).append(c)
    shown = set()
    for cases in points.values():
        public = [c for c in cases if is_public(c)]
        pool = [c for c in public if id(c) in active_ids] or public
        if not pool:
            continue
        best = pool[0]
        for c in pool[1:]:
            if later(c, best):
                best = c
        shown.add(id(best))
    res.points = points
    res.shared = [cases for cases in points.values() if len(cases) > 1]
    res.open_points = [k for k, cases in points.items() if any(id(c) in active_ids for c in cases)]
    res.public_points = len(shown)
    res.public_open_sets = sum(1 for c in rows if id(c) in shown and id(c) in active_ids)
    res.not_public = [c for c in rows if not is_public(c)]

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
                'StmtOther': other, 'County': c.county, 'Animal': animal_of(c)}})

    # The figures the check prints (report.js figures on the same rows).
    res.counties = sorted(set(c.county for c in rows if c.county in WA_COUNTIES))
    zoned = [c for c in res.active if c.lat is not None]
    res.area_counties = sorted(set(c.county or COUNTY_NOT_GIVEN for c in zoned))
    res.zoned_active = zoned
    res.active_by_kind = [sum(1 for c in res.active if k in c.kinds) for k in range(len(KINDS))]
    res.zoned_by_kind = [sum(1 for c in rows if c.lat is not None and k in c.kinds) for k in range(len(KINDS))]
    res.areas_by_kind = [sum(1 for c in zoned if k in c.kinds) for k in range(len(KINDS))]
    # The same figures for the animals the public sees, as the public dashboard counts them.
    res.public_rows = [c for c in rows if is_public(c)]
    res.public_active = [c for c in res.active if is_public(c)]
    res.public_counties = sorted(set(c.county for c in res.public_rows if c.county in WA_COUNTIES))
    res.mixed = [c for c in rows if len(c.kinds) > 1]
    return res


def kept_cases(table, today):
    """The cases the cases table holds, in its order: those of an animal the public sees (PUBLIC_ANIMALS), but not
    those detected after today."""
    return [c for c in table.cases if is_public(c) and not (c.detected and c.detected > today)]


def case_rows(table, today):
    """The cases table's rows: every row of the table of an animal the public sees (the update counts rows without a
    point too) but those detected after today (a date typed wrongly; the check lists them to fix), the eleven fields only, dates as dates at midday
    (so no time zone moves them to the day before). A row detected after a past date checked stays: the dashboard
    counts by date."""
    out = []
    for c in kept_cases(table, today):
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
                role = {'Quarantine Status': 'quarantine_status', 'Status': 'status', 'County': 'county', 'State': 'state',
                        'Flock/Herd Type': 'flock_type', 'Species': 'species'}[label]
                row.append(v(role) or None)
        out.append(row)
    return out


def safe_cell(v):
    """A cell as a spreadsheet opens it safely: one starting with =, +, -, @, a tab or a carriage return would be read
    as a formula, so it gets a single quote before it; a lone + or - (a blank written as a dash) is left as it is."""
    if v in ('+', '-'):
        return v
    return "'" + v if v[:1] in ('=', '+', '-', '@', '\t', '\r') else v


def cases_csv(table, today):
    """hpai-cases-public.csv: the cases table's rows as a file, a copy for the records (dates as M/D/YYYY)."""
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
                '(made from the starter file).']
    out = []
    for name, kind, length in ZONE_FIELDS:
        f = names.get(name.lower())
        if not f:
            out.append('The zones layer has no ' + name + ' field.' +
                       (' A zones layer made before 2.9.1 lacks it: add it to WSDA HPAI Zones (source) as a String '
                        'field of 100 characters (the item page > Data > Fields > Add field). The public view needs '
                        'no change.' if name == 'Animal' else ''))
        elif kind == 'TEXT' and f[1] not in ('String', 'TEXT'):
            out.append('The zones layer\'s ' + name + ' field is not a text field.')
    need = {'Statement1': len(STATEMENT_OPEN[0]), 'Statement2': len(STATEMENT_OPEN[1]),
            'Animal': len(', '.join(ANIMAL_NAMES))}
    for name, n in need.items():
        f = names.get(name.lower())
        if f and f[2] and f[2] < n:
            out.append('The zones layer\'s ' + name + ' field holds ' + str(f[2]) + ' characters; ' +
                       ('the notice is ' + str(n) + '.' if name != 'Animal' else 'it needs ' + str(n) + ' ("' +
                        ', '.join(ANIMAL_NAMES) + '"): make it a String field of 100 characters.'))
    extra = sorted(n for k, (n, _, _) in names.items() if k not in SYSTEM_FIELDS and k not in [z[0].lower() for z in ZONE_FIELDS])
    if extra:
        out.append('The zones layer has fields the new zones layer does not: ' + ', '.join(extra) + '.')
    return out


def norm(name):
    return re.sub(r'[^a-z0-9]', '', name.lower())


def check_case_fields(fields):
    """Problems with the cases table, from its fields as (name, type, length), and the field each of the eleven is
    written to: (problems, [field name per CASE_FIELDS])."""
    names = {norm(n): (n, t, ln) for n, t, ln in fields}
    out, target = [], []
    for label, arc_name, kind in CASE_FIELDS:
        f = names.get(norm(arc_name))
        if not f:
            out.append('The cases table has no field for ' + label + ' (looked for ' + arc_name + ').' +
                       (' A cases table made before 2.9.1 lacks it: add it as a String field (the item page > Data > '
                        'Fields > Add), then tick it in the public view\'s fields (the view\'s item page > '
                        'Visualization or Settings > Define view), so the public sees it.'
                        if arc_name in ('Quarantine_Status', 'State') else ''))
            target.append(None)
            continue
        target.append(f[0])
        if kind == 'DATE' and f[1] != 'Date':
            out.append('The cases table\'s ' + f[0] + ' field is a ' + ('"Date only"' if f[1] == 'DateOnly' else f[1]) +
                       ' field; it must be a "Date" field (date and time; the counting rules read it). Make the cases '
                       'table from the starter file (step 2).')
        if kind == 'LONG' and f[1] not in ('Integer', 'SmallInteger', 'BigInteger', 'Double', 'Single'):
            out.append('The cases table\'s ' + f[0] + ' field is not a number field.')
        if kind == 'TEXT' and f[1] not in ('String', 'TEXT'):
            out.append('The cases table\'s ' + f[0] + ' field is a ' + f[1] + ' field; it must be a String (text) '
                       'field.')
    wanted = set(norm(a) for _, a, _ in CASE_FIELDS)
    extra = sorted(n for k, (n, _, _) in names.items() if k not in wanted and k not in SYSTEM_FIELDS)
    if extra:
        out.append('The cases table has fields beyond the eleven: ' + ', '.join(extra) + '. Make it from the starter '
                   'file (step 2), so nothing else of the table reaches ArcGIS Online; a new cases table needs a new '
                   'public view (step 4) and its item ID in the counting rules (step 7).')
    return out, target


def check_online(path, what):
    """Problems with where a layer's data is: [] when it is an online layer (its address starts http:// or https://). The
    starter file's HPAI_Zones and a copy's zones_before have the right fields too, but written to, the public map
    would not change."""
    if re.match(r'https?://', path or '', re.I):
        return []
    return ['The ' + what + ' picked is a file (' + str(path) + '), not the online layer: pick the one added from '
            'the Portal in step 3 (right-click > Properties > Source starts https://).']


def check_system(code):
    """Problems with the zones layer's coordinate system (its factory code): [] for Web Mercator or WGS 84, the two the
    tool's circles go into without a datum change."""
    if code in (3857, 102100, 4326):
        return []
    return ['The zones layer uses a different map projection (code ' + str(code) + ') from the one the tool draws in '
            '(Web Mercator, code 3857, as the starter file makes it). Publish the zones layer from the starter file '
            '(step 2).']


def value_problems(table, res, zone_fields, case_fields, statement_other=None):
    """Values too long or too large for the field they go to, as lines naming the rows: a write would fail on them
    each time. zone_fields and case_fields: the target's fields as (name, type, length), case_fields in CASE_FIELDS'
    order (None for a cases table not given)."""
    out = []
    zl = dict((n.lower(), ln) for n, t, ln in zone_fields)
    other = (statement_other or '').strip()
    if other and zl.get('stmtother') and len(other) > zl['stmtother']:
        out.append('Additional information has ' + str(len(other)) + ' characters; the zones layer\'s StmtOther field '
                   'holds ' + str(zl['stmtother']) + '.')
    long_county = [z['case'] for z in res.zones if z['attributes']['County'] and zl.get('county')
                   and len(z['attributes']['County']) > zl['county']]
    if long_county:
        seen = []
        for c in long_county:
            if c not in seen:
                seen.append(c)
        out.append('A County longer than the zones layer\'s County field (' + str(zl['county']) + ' characters): ' +
                   named(seen) + '.')
    if case_fields:
        cases = kept_cases(table, res.today)
        for k, row in enumerate(case_rows(table, res.today)):
            for (label, _, _), f, v in zip(CASE_FIELDS, case_fields, row):
                if f is None or v is None:
                    continue
                name, kind, length = f
                if isinstance(v, str) and length and len(v) > length:
                    out.append(label + ' in ' + cases[k].name() + ' has ' + str(len(v)) + ' characters; the cases '
                               'table\'s ' + name + ' field holds ' + str(length) + '.')
                elif isinstance(v, int) and kind in FIELD_MAX and v > FIELD_MAX[kind]:
                    out.append(label + ' in ' + cases[k].name() + ' is ' + str(v) + ', larger than the cases table\'s ' +
                               name + ' field holds.')
    return out


# ---- The check ---------------------------------------------------------------------------------------------------

def long_date(d):
    return d.strftime('%B ') + str(d.day) + d.strftime(', %Y')


def named(cases, limit=LIST_LIMIT, show=None):
    """The cases' names, the first `limit` (None: all, as the check file lists them), then how many more. show: a role
    (or a function of the case) whose value as typed follows each name ('row 2 (K 01) "Chickn"'), when it is not
    blank."""
    def name(c):
        typed = (show(c) if callable(show) else c.values.get(show)) if show else None
        return c.name() + (' "' + typed + '"' if typed else '')
    names = [name(c) for c in (cases if limit is None else cases[:limit])]
    more = len(cases) - len(names)
    return ', '.join(names) + (', and ' + str(more) + ' more' if more > 0 else '')


def plural(n, one, many):
    return str(n) + ' ' + (one if n == 1 else many)


def by_kind(counts, one, many):
    """Counts by kind of animal, as the Animal field names them: "Birds 70 cases, Cattle 7 cases" (a case of two
    kinds counts in both)."""
    return ', '.join(ANIMAL_NAMES[k] + ' ' + plural(n, one, many) for k, n in enumerate(counts) if n) or 'none'



def to_fix(table, res):
    """The rows staff should fix in the table, one line each: (what, [Case], the column whose typed value follows
    each name, or None)."""
    out = []
    points = table.bad.get('point', [])
    for why in POINT_PROBLEMS:
        cases = [c for c in points if c.point_problem == why]
        if cases:
            out.append(('Coordinates: ' + why + ', no zones until fixed', cases))
    if table.bad.get('outside'):
        out.append(('Coordinates outside Washington (zones drawn; check them)', table.bad['outside']))
    if table.bad.get('decimals'):
        out.append(('Coordinates with fewer than ' + str(MIN_DECIMALS) + ' decimals (zones drawn, maybe in the wrong '
                    'place: Excel saves what the cell shows; format both columns to 5 decimals before saving)',
                    table.bad['decimals']))
    if table.bad.get('quotes'):
        out.append(('A cell holding several lines (a stray quote mark? the rows after it may be inside it; check this '
                    'row and the next ones in Excel)', table.bad['quotes']))
    if table.bad.get('long_text'):
        out.append(('A Species, Status or Flock/Herd Type over ' + str(LONG_TEXT) + ' characters (public as written: '
                    'check it holds no name or address)', table.bad['long_text']))
    for kind in sorted(k for k in table.bad if k.startswith('date:')):
        out.append(('A date that could not be read in ' + kind[5:] + ' (counted as blank; ' + DATE_HELP + ')' +
                    (' A real run stops until it is fixed.' if kind == close_kind(table) else ''), table.bad[kind]))
    if res.after_today:
        out.append(('Detected after today (left out; check the date)', res.after_today))
    if res.release_after_today:
        out.append(('A Quarantine Release later than today (not taken as the day closed)', res.release_after_today))
    if table.bad.get('county'):
        out.append(('A County that is not one of Washington\'s 39 (counted as written; a typing slip?)', table.bad['county']))
    if table.bad.get('state'):
        out.append(('A State that is not Washington (written as given; check it)', table.bad['state']))
    if table.bad.get('quarantine_status'):
        out.append(('A Quarantine Status that is not "Under quarantine" or "Released" (written as given)',
                    table.bad['quarantine_status']))
    if table.bad.get('inventory'):
        out.append(('A Flock/Herd Inventory that is not a whole number (left blank)', table.bad['inventory']))
    if table.bad.get('species_unknown'):
        out.append(('A Species the tool does not recognize (counted as other animals' +
                    ('' if is_public_kind(len(KINDS) - 1) else ', so not on the public map') + '; a typing slip? '
                    'README.txt, "Species")', table.bad['species_unknown'], 'species'))
    if table.bad.get('species_mixed'):
        out.append(('A Species naming more than one kind of animal (counted as each; check it names the animals, '
                    'not a farm, as "Sample Eagle Dairy" would)', table.bad['species_mixed'], 'species'))
    if table.bad.get('species_words'):
        out.append(('A Species with a word that is not an animal (a farm\'s name or a place? public as written; '
                    'check it)', table.bad['species_words'], 'species'))
    if table.bad.get('species_blank_other'):
        out.append((SPECIES_BLANK_OTHER, table.bad['species_blank_other'], typed_type))
    if table.bad.get('digits'):
        out.append((DIGITS, table.bad['digits'], typed_species_or_type))
    if table.bad.get('species_blank'):
        out.append(('Species blank, or Unknown, N/A, TBD, - or ? (counted as birds' +
                    (', so on the public map' if is_public_kind(0) else '') + '; if this case is not birds, fill in '
                    'Species)', table.bad['species_blank'], 'species'))
    return [x if len(x) == 3 else x + (None,) for x in out]


# Why a row's coordinates give no map point (besides none at all), in the order the check lists them.
POINT_PROBLEMS = ('latitude and longitude look swapped', SIGN_SLIP, ZERO_POINT, 'coordinates not readable', 'no latitude',
                  'no longitude')


def close_kind(table):
    """The table.bad key for a Close Date that could not be read."""
    return 'date:' + table.columns.get('close_date', 'Close Date')


# A table without a Species column: every case would count as birds, so every case would be on the public map.
NO_SPECIES = ('The HPAI table has no Species column (looked for Species and Species Group): every case would count '
              'as birds, on the public map. Check the heading\'s spelling.')


# What a real run stops for in the rows (2.9.1), with what was typed.
SPECIES_BLANK_OTHER = ('Species blank (or Unknown, N/A, TBD, - or ?) where Flock/Herd Type or Production Type names '
                       'another animal (it would go on the public map as birds; fill in Species. A real run stops until '
                       'it is fixed.)')
DIGITS = ('A Species or Flock/Herd Type with a digit in it (an address or a phone number? public as written; take it '
          'out. A real run stops until it is fixed.)')


def typed_type(c):
    return c.other_type


def typed_species_or_type(c):
    return ' / '.join(x for x in (c.values.get('species'), c.values.get('flock_type')) if x and re.search(r'\d', x))


# A Species column with nothing in it (or only Unknown, N/A, ...): the same, every case would count as birds.
EMPTY_SPECIES = ('The HPAI table\'s Species column is blank (or Unknown, N/A, TBD) in every row: every case would count '
                 'as birds, on the public map. Check that the file picked is the HPAI table, with Species filled in.')


def species_problem(table):
    """Why the table's Species cannot be used to keep other animals off the public map, or None."""
    if 'species' in table.missing:
        return NO_SPECIES
    if table.cases and all(species_blank(c.values.get('species')) for c in table.cases):
        return EMPTY_SPECIES
    return None


def blockers(table):
    """What stops a real run (Check only still runs): a Close Date that could not be read would leave a closed site
    active on the public map; without Species (no column, or one blank in every row) every case would go on it as
    birds; a PUBLIC_ANIMALS the tool cannot use would leave the public map empty."""
    out = []
    for problem in (public_setting_problem(), species_problem(table)):
        if problem:
            out.append(problem)
    if table.bad.get('species_blank_other'):
        out.append('Species blank where the type names another animal: ' +
                   named(table.bad['species_blank_other'], show=typed_type) + '. Fill in Species.')
    if table.bad.get('digits'):
        out.append('A digit in Species or Flock/Herd Type: ' + named(table.bad['digits'], show=typed_species_or_type) +
                   '. Take it out.')
    cases = table.bad.get(close_kind(table), [])
    if cases:
        out.append('A Close Date that could not be read: ' + named(cases) + '. ' + DATE_HELP)
    return out


def point_warnings(table):
    """The tool's window, as soon as the table is picked: the rows whose coordinates or dates need a look, each with
    why; '' when there are none."""
    out = []
    for problem in (public_setting_problem(), species_problem(table)):
        if problem:
            out.append(problem + ' A real run stops until it is fixed.')
    points = table.bad.get('point', [])
    for why in POINT_PROBLEMS:
        cases = [c for c in points if c.point_problem == why]
        if cases:
            out.append('No zones, ' + why + ': ' + named(cases) + '.')
    if table.bad.get('outside'):
        out.append('Zones drawn, outside Washington: ' + named(table.bad['outside']) + '.')
    if table.bad.get('decimals'):
        out.append('Zones drawn, coordinates with fewer than ' + str(MIN_DECIMALS) + ' decimals (Excel may have '
                   'rounded them): ' + named(table.bad['decimals']) + '.')
    if table.bad.get('quotes'):
        out.append('A cell holding several lines (a stray quote mark?): ' + named(table.bad['quotes']) + '.')
    if table.bad.get('long_text'):
        out.append('A long Species, Status or Flock/Herd Type (public as written): ' + named(table.bad['long_text']) + '.')
    if table.bad.get('species_unknown'):
        out.append('A Species the tool does not recognize (counted as other animals, not birds): ' +
                   named(table.bad['species_unknown'], show='species') + '.')
    if table.bad.get('species_mixed'):
        out.append('A Species naming more than one kind (counted as each; a farm\'s name?): ' +
                   named(table.bad['species_mixed'], show='species') + '.')
    if table.bad.get('species_blank_other'):
        out.append('Species blank where the type names another animal (a real run stops until Species is filled '
                   'in): ' + named(table.bad['species_blank_other'], show=typed_type) + '.')
    if table.bad.get('digits'):
        out.append('A digit in Species or Flock/Herd Type (a real run stops until it is taken out): ' +
                   named(table.bad['digits'], show=typed_species_or_type) + '.')
    if table.bad.get('species_words'):
        out.append('A Species with a word that is not an animal (public as written): ' +
                   named(table.bad['species_words'], show='species') + '.')
    if table.bad.get('species_blank'):
        out.append('Species blank or Unknown (counted as birds, on the public map): ' +
                   named(table.bad['species_blank'], show='species') + '.')
    dates = [k for k in sorted(table.bad) if k.startswith('date:')]
    for kind in dates:
        out.append('A date not read in ' + kind[5:] + (' (a real run stops until it is fixed)' if kind == close_kind(table)
                                                       else '') + ': ' + named(table.bad[kind]) + '.')
    if dates:
        out.append(DATE_HELP)
    return ' '.join(out)


def check_lines(table, res, check_only, limit=LIST_LIMIT):
    """The check, as (level, text) lines: level 'info' or 'warning' (ArcGIS Pro shows warnings in yellow). One
    ('steps', None) line marks where the toolbox says steps 4 and 5 (the writing), as they happen. limit: how many
    rows each list names (None: all, for the check file)."""
    out = []
    say = lambda t, level='info': out.append((level, t))
    names = lambda cases, show=None: named(cases, limit, show)
    say('HPAI ZONES TOOL, ' + long_date(res.on) + (' (CHECK ONLY: nothing is written)' if check_only else ''))
    say('=' * 50)
    say('[1/5] Reading the HPAI table')
    say('      ' + plural(len(table.cases), 'row', 'rows') + '. Read: ' + ', '.join(table.columns.values()) + '.')
    if table.never_read:
        say('      Never read: ' + ', '.join(table.never_read) + '.')
    for role in table.missing:
        if role not in ('case_id', 'production_type'):
            say('      Not found: ' + COLUMNS[role][0] + '.' + (' The cases table\'s ' + COLUMNS[role][0] +
                ' is left blank.' if role in ('quarantine_status', 'state') else '') +
                (' Every case would count as birds, on the public map: a real run stops.' if role == 'species' else '') +
                ' If the table has it, check the heading\'s spelling (README.txt, "The table").', 'warning')
    say('[2/5] Active or closed on ' + long_date(res.on) + ' (the Emergency dashboard\'s rules)')
    say('      ' + plural(len(res.rows), 'case', 'cases') + '.' + (' ' + plural(len(res.later), 'row', 'rows') +
        ' detected after ' + long_date(res.on) + ' left out: ' + names(res.later) + '.' if res.later else ''))
    say('      ' + str(len(res.active)) + ' active, ' + str(len(res.rows) - len(res.active)) + ' closed.')
    if res.undated:
        say('      ' + plural(len(res.undated), 'case', 'cases') + ' without a readable detection date, counted in no '
            'month: ' + names(res.undated) + '.')
    if res.closed_day_unknown:
        say('      ' + plural(len(res.closed_day_unknown), 'case', 'cases') + ' closed by Status alone, the day closed '
            'not known (fine; add a Close Date if it is known): ' + names(res.closed_day_unknown) + '.')
    say('[3/5] The zones (3 km infection zone, 3 to 10 km control ring, around each case\'s map point)')
    zoned = [c for c in res.rows if c.lat is not None]
    say('      ' + plural(len(zoned), 'case', 'cases') + ' with a map point: ' + str(len(res.zones)) + ' zones, at ' +
        plural(len(res.points), 'map point', 'map points') + ' (' + str(len(res.open_points)) + ' open).')
    if res.no_point:
        say('      ' + plural(len(res.no_point), 'case has no map point and gets', 'cases have no map point and get') +
            ' no zones: ' +
            names(res.no_point) + '.')
    if res.shared:
        say('      ' + plural(len(res.shared), 'map point has', 'map points have') + ' more than one case: every case\'s '
            'zones written, the public sees at most one set (the latest active case\'s of ' + public_words() + ', '
            'or the latest closed one\'s; none at a point without one):')
        for cases in (res.shared if limit is None else res.shared[:limit]):
            say('        ' + names(cases))
        if limit is not None and len(res.shared) > limit:
            say('        and ' + str(len(res.shared) - limit) + ' more')
    mixed = '; a case naming two kinds counts in both' if res.mixed else ''
    say('      By animal (the Animal field' + mixed + '): ' + by_kind(res.zoned_by_kind, 'case', 'cases') + '.')
    if public_setting_problem():
        say('      ' + public_setting_problem(), 'warning')
    elif not all_public():
        hidden = [sum(1 for c in res.not_public if k in c.kinds) for k in range(len(KINDS))]
        say('      The public sees ' + public_words() + ' only (README.txt, "Birds only"): ' +
            plural(res.public_points, 'map point', 'map points') + ' shown.' +
            (' ' + plural(len(res.not_public), 'case', 'cases') + ' of other kinds (' + by_kind(hidden, 'case', 'cases') +
             '): zones written but not shown, and left out of the cases table: ' + names(res.not_public) + '.'
             if res.not_public else ''))
    say('      The open sites\' notice: ' + str(len(STATEMENT_OPEN[0])) + ' characters, written whole.')
    fixes = to_fix(table, res)
    kinds = [plural(n, KINDS[k][1][0], KINDS[k][1][1]) for k, n in enumerate(res.active_by_kind) if n]
    out.append(('steps', None))   # steps 4 and 5 are said by the toolbox, where they happen
    pub = '' if all_public() or public_setting_problem() else '; the public dashboard\'s, ' + public_words() + ': '
    say('THE CHECK (compare with the update)')
    say('  Cases ............................ ' + str(len(res.rows)) +
        ('   (' + pub[2:] + str(len(res.public_rows)) + ')' if pub else ''))
    say('  Active ........................... ' + str(len(res.active)) +
        ('   (' + ', '.join(kinds) + (pub + str(len(res.public_active)) if pub else '') + ')' if kinds else ''))
    say('  Counties affected ................ ' + str(len(res.counties)) + '   (Washington\'s' +
        (pub + str(len(res.public_counties)) if pub else '') + ')')
    say('  Active surveillance areas ........ ' + str(len(res.zoned_active)) + ' (active cases with a map point), in ' +
        plural(len(res.area_counties), 'county', 'counties') + (' (' + ', '.join(res.area_counties) + ')' if res.area_counties else ''))
    if res.zoned_active:
        say('                                     by animal: ' + by_kind(res.areas_by_kind, 'area', 'areas') +
            ('; on the public map: ' + plural(res.public_open_sets, 'set of zones', 'sets of zones') if pub else ''))
    if fixes:
        say('TO FIX IN THE TABLE (' + plural(sum(len(c) for _, c, _ in fixes), 'row', 'rows') + ')', 'warning')
        for what, cases, show in fixes:
            say('  ' + what + ': ' + names(cases, show) + '.', 'warning')
    return out
