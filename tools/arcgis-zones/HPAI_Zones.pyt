# -*- coding: utf-8 -*-
"""
HPAI Zones: an ArcGIS Pro toolbox that rebuilds the public HPAI zones and the location-free cases table from the
agreed HPAI table (the same file the Emergency dashboard reads). Keep zone_rules.py in the same folder.

Two tools:
    Rebuild the HPAI zones and cases table   every month, after the HPAI table is updated
    Make the starter file                    once: an empty zones layer and cases table with the right fields

The rules (active or closed, the zones, the check) are in zone_rules.py, in plain Python, tested outside ArcGIS; this
file only reads the parameters, checks the layers and writes. Nothing passes through a shapefile (a shapefile's text
fields hold 254 characters, which cut today's notice). The tool writes only to the new zones layer: today's public
zones layer is refused by its fields (zone_rules.check_zone_fields), a file with the right fields (the starter file, a
copy) by its address (zone_rules.check_online).

Writing order: a copy of what is there first (a file geodatabase), then the new rows
added, then the old rows removed; if adding fails, the rows added are removed again, so the layer is as it was.
"""

import os
import importlib.util
from datetime import date, datetime

import arcpy

# zone_rules.py from this toolbox's own folder, loaded afresh each time ArcGIS Pro loads the toolbox (a changed file is
# used without restarting Pro) and under no shared name, so two copies of the tool in one session (an old folder and
# a new one) each run their own rules.
_spec = importlib.util.spec_from_file_location('hpai_zone_rules',
                                               os.path.join(os.path.dirname(os.path.abspath(__file__)), 'zone_rules.py'))
Z = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(Z)

WGS84 = 4326
WEB_MERCATOR = 3857
CHUNK = 500   # rows removed per request


def fields_of(data):
    """A layer's or table's fields as (name, type, length), for zone_rules' checks."""
    return [(f.name, f.type, f.length) for f in arcpy.ListFields(data)]


def source_of(data):
    """The data behind a layer (its feature class, table or service), so a layer's selection or definition query
    never limits what is replaced."""
    return arcpy.Describe(data).catalogPath


def oids(data):
    return set(r[0] for r in arcpy.da.SearchCursor(data, ['OID@']))


def remove(data, ids):
    """Removes the rows with these ObjectIDs, CHUNK at a time."""
    ids = sorted(ids)
    oid_field = arcpy.AddFieldDelimiters(data, arcpy.Describe(data).OIDFieldName)
    for i in range(0, len(ids), CHUNK):
        where = oid_field + ' IN (' + ','.join(str(n) for n in ids[i:i + CHUNK]) + ')'
        with arcpy.da.UpdateCursor(data, ['OID@'], where) as cur:
            for _ in cur:
                cur.deleteRow()


def replace(data, fields, rows, what, say, also=''):
    """Adds the rows, then removes the ones there before; if adding fails, removes what was added and stops. also:
    words added to a failure's message (what this run had already changed)."""
    before = oids(data)
    try:
        with arcpy.da.InsertCursor(data, fields) as cur:
            for row in rows:
                cur.insertRow(row)
    except Exception:
        added = oids(data) - before
        if added:
            remove(data, added)
        say('FAILED while adding ' + what + ': the ' + str(len(added)) + ' added were removed again, so the ' + what +
            ' are as they were before the run.' + also + ' Run again; if it fails the same way, send the check file '
            '(it holds the error) and a screenshot of the messages to whoever looks after the tool.', 'error')
        raise
    try:
        remove(data, before)
    except Exception:
        say('FAILED while removing the old ' + what + ': the new ones are in, some old ones may be left (the public '
            'may see some twice).' + also + ' Run the tool again soon (it replaces everything).', 'error')
        raise
    return len(rows), len(before)


_read_cache = {}


def read_cached(path):
    """The table, read once per change of the file (the window checks it each time a box changes)."""
    stamp = (path, os.path.getmtime(path), os.path.getsize(path))
    if stamp not in _read_cache:
        _read_cache.clear()
        with open(path, 'rb') as f:
            raw = f.read()
        try:
            _read_cache[stamp] = Z.read_table(raw)
        except Z.TableError as e:
            _read_cache[stamp] = e
    return _read_cache[stamp]


class Toolbox(object):
    def __init__(self):
        self.label = 'HPAI Zones'
        self.alias = 'hpaizones'
        self.tools = [RebuildZones, MakeStarter]


class RebuildZones(object):
    def __init__(self):
        self.label = 'Rebuild the HPAI zones and cases table'
        self.description = ('Reads the agreed HPAI table, works out which cases are active or closed, rebuilds every '
                            'case\'s zones (3 km infection zone, 3 to 10 km control ring, the whole notice) and the '
                            'cases table (eleven fields, no location), and prints a check. With "Check only" ticked '
                            'the layers are not written; the check and the cases file are saved in the folder.')
        self.canRunInBackground = False

    def getParameterInfo(self):
        table = arcpy.Parameter(displayName='HPAI table (.csv)', name='hpai_table', datatype='DEFile',
                                parameterType='Required', direction='Input')
        table.filter.list = ['csv']
        zones = arcpy.Parameter(displayName='Zones layer (the online one: WSDA HPAI Zones (source))', name='zones',
                                datatype='GPFeatureLayer', parameterType='Required', direction='Input')
        zones.filter.list = ['Polygon']
        cases = arcpy.Parameter(displayName='Cases table (the online one: WSDA HPAI Cases (source); blank: not changed)',
                                name='cases',
                                datatype='GPTableView', parameterType='Optional', direction='Input')
        on = arcpy.Parameter(displayName='Active on (optional; blank: today; a past date only to check an old update)',
                             name='active_on', datatype='GPDate', parameterType='Optional', direction='Input')
        other = arcpy.Parameter(displayName='Additional information (optional; shown in every zone\'s public pop-up: '
                                            'no names or addresses)',
                                name='statement_other', datatype='GPString', parameterType='Optional', direction='Input')
        folder = arcpy.Parameter(displayName='Folder for the backup copy and the check file (the HPAI zones folder)',
                                 name='folder', datatype='DEFolder', parameterType='Required', direction='Input')
        check_only = arcpy.Parameter(displayName='Check only (the layers are not changed)', name='check_only',
                                     datatype='GPBoolean', parameterType='Optional', direction='Input')
        check_only.value = True   # ticked each time the tool opens
        return [table, zones, cases, on, other, folder, check_only]

    def isLicensed(self):
        return True

    def updateParameters(self, parameters):
        return

    def updateMessages(self, parameters):
        """Shown in the window before anything runs: the table's problems (coordinates to fix as a warning), and a
        zones layer or cases table the tool will not write to."""
        table, zones, cases = parameters[0], parameters[1], parameters[2]
        # Each box checked on its own, so a problem with one never hides another's; anything unexpected is left to the
        # run, which says what is wrong.
        try:
            if table.valueAsText and os.path.isfile(table.valueAsText):
                t = read_cached(table.valueAsText)
                if isinstance(t, Z.TableError):
                    table.setErrorMessage(str(t))
                else:
                    w = Z.point_warnings(t)
                    if w:
                        table.setWarningMessage(w)
        except Exception:
            pass
        try:
            if zones.value:
                src = source_of(zones.valueAsText)
                problems = (Z.check_zone_fields(fields_of(src)) or Z.check_online(src, 'zones layer') or
                            Z.check_system(arcpy.Describe(src).spatialReference.factoryCode))
                if problems:
                    zones.setErrorMessage(' '.join(problems))
        except Exception:
            pass
        try:
            if cases.value:
                src = source_of(cases.valueAsText)
                problems = Z.check_case_fields(fields_of(src))[0] or Z.check_online(src, 'cases table')
                if problems:
                    cases.setErrorMessage(' '.join(problems))
        except Exception:
            pass
        return

    def execute(self, parameters, messages):
        p = parameters
        table_path = p[0].valueAsText
        today = date.today()
        on = p[3].value.date() if isinstance(p[3].value, datetime) else (p[3].value or today)
        folder = p[5].valueAsText
        check_only = bool(p[6].value)
        stamp = datetime.now().strftime('%Y-%m-%d_%H%M%S')   # to the second, so a run straight after never replaces a copy
        log = []

        def show(text, level='info'):
            if level == 'error':
                arcpy.AddError(text)
            elif level == 'warning':
                arcpy.AddWarning(text)
            else:
                arcpy.AddMessage(text)

        def say(text, level='info'):
            log.append(text)
            show(text, level)

        def tell(lines, full):
            """Lines of the check: the messages name up to ten rows in each list, the check file every row."""
            for level, text in lines:
                show(text, level)
            log.extend(text for _, text in full)

        def stop(text):
            say('STOPPED: ' + text + ' Nothing changed.', 'error')
            save_log()

        def save_log():
            path = os.path.join(folder, 'hpai_zones_check_' + stamp + '.txt')
            try:
                with open(path, 'w', encoding='utf-8', newline='\r\n') as f:
                    f.write('\n'.join(log) + '\n')
                arcpy.AddMessage('Saved as ' + path)
            except OSError as e:
                arcpy.AddWarning('The check file could not be saved in the folder (' + str(e) + '); the messages '
                                 'above are the check.')

        # Everything is read and checked before anything is written.
        with open(table_path, 'rb') as f:
            raw = f.read()
        try:
            table = Z.read_table(raw)
        except Z.TableError as e:
            return stop(str(e))
        if not any(c.lat is not None for c in table.cases):
            return stop('0 of ' + str(len(table.cases)) + ' rows have a map point (probably the wrong file).')
        other = (p[4].valueAsText or '').strip()
        if other:
            say('Additional information, shown in every zone\'s public pop-up: "' + other + '"')
        if on > today:
            say('"Active on" is after today: cases are counted as they would be on ' + Z.long_date(on) + '.', 'warning')
        zones_src = source_of(p[1].valueAsText)
        problems = (Z.check_zone_fields(fields_of(zones_src)) or Z.check_online(zones_src, 'zones layer') or
                    Z.check_system(arcpy.Describe(zones_src).spatialReference.factoryCode))
        if problems:
            return stop(' '.join(problems))
        cases_src = source_of(p[2].valueAsText) if p[2].value else None
        case_targets = None
        if cases_src:
            problems, case_targets = Z.check_case_fields(fields_of(cases_src))
            problems = problems or Z.check_online(cases_src, 'cases table')
            if problems:
                return stop(' '.join(problems))

        if not cases_src:
            say('No cases table given: it is not changed in this run. If it was last filled before 2.9.1, it still holds '
                'every animal\'s rows, public through its view: run again with WSDA HPAI Cases (source) in the Cases '
                'table box.', 'warning')

        res = Z.build(table, on, today, p[4].valueAsText)
        lines = Z.check_lines(table, res, check_only)
        full = Z.check_lines(table, res, check_only, limit=None)
        at = [i for i, (level, _) in enumerate(lines) if level == 'steps'][0]
        at_full = [i for i, (level, _) in enumerate(full) if level == 'steps'][0]

        # What a write would fail on every time, and what stops a real run: Check only lists them, a
        # real run stops before writing anything.
        case_fields = None
        if cases_src:
            kinds = dict((n, (n, t, ln)) for n, t, ln in fields_of(cases_src))
            case_fields = [kinds.get(n) for n in case_targets]
        stops = Z.value_problems(table, res, fields_of(zones_src), case_fields, p[4].valueAsText) + Z.blockers(table)
        if stops and not check_only:
            tell([x for x in lines if x[0] != 'steps'], [x for x in full if x[0] != 'steps'])
            return stop('Fix these in the HPAI table (or the box named), save it and run again: ' + ' '.join(stops))

        tell(lines[:at], full[:at_full])

        # The cases file: the public cases table's rows, a copy for the records (nothing to upload). Not written when
        # the tool cannot tell birds from other animals (no Species, or a setting it cannot use): it would hold them all.
        csv_path = os.path.join(folder, 'hpai-cases-public.csv')
        unsorted = Z.species_problem(table) or Z.public_setting_problem()
        if not unsorted:
            try:
                with open(csv_path, 'w', encoding='utf-8', newline='') as f:
                    f.write(Z.cases_csv(table, res.today))
            except OSError as e:
                return stop('hpai-cases-public.csv could not be written (' + str(e) + '). If it is open in Excel, close '
                            'it and run again.')

        if check_only:
            say('[4/5] Check only: the zones layer not written (' + zones_src + ').')
            say('[5/5] Check only: the cases table not written' + (' (' + cases_src + ').' if cases_src else '.'))
            if unsorted:
                say('      hpai-cases-public.csv not written: the tool cannot yet tell birds from other animals.')
            else:
                say('      Saved: ' + csv_path + ' (' + str(len(Z.case_rows(table, res.today))) + ' rows, ' +
                    str(len(Z.CASE_FIELDS)) + ' columns; a copy for your records, nothing to upload).')
        else:
            try:
                write(zones_src, cases_src, case_targets, table, res, folder, stamp, csv_path, say)
            except Exception as e:
                log.append('The error: ' + str(e))   # in the check file too, for whoever looks after the tool
                save_log()   # what was said, up to the failure
                raise

        tell(lines[at + 1:], full[at_full + 1:])
        if stops:
            say('A REAL RUN WILL STOP until these are fixed: ' + ' '.join(stops), 'warning')
        say('=' * 50)
        say('CHECK ONLY. Untick "Check only" and run again to write.' if check_only
            else 'DONE. The public map follows by itself.')
        save_log()


def write(zones_src, cases_src, case_targets, table, res, folder, stamp, csv_path, say):
    """Steps 4 and 5: a copy of what is there, then the zones layer and the cases table replaced."""
    gdb_name = 'hpai_zones_before_' + stamp + '.gdb'
    arcpy.management.CreateFileGDB(folder, gdb_name)
    gdb = os.path.join(folder, gdb_name)
    say('[4/5] Writing the zones layer (' + zones_src + ')')
    arcpy.management.CopyFeatures(zones_src, os.path.join(gdb, 'zones_before'))
    say('      Copy of what was there: ' + gdb)
    say('      ' + replace_zones(zones_src, res, say))
    say('[5/5] Writing the cases table' + (' (' + cases_src + ')' if cases_src else ''))
    if cases_src:
        arcpy.management.CopyRows(cases_src, os.path.join(gdb, 'cases_before'))
        rows = Z.case_rows(table, res.today)
        added, removed = replace(cases_src, case_targets, rows, 'cases', say,
                                 ' The zones layer was already rewritten in this run; the copies from before it are in ' +
                                 gdb + '.')
        say('      ' + str(added) + ' rows added, then the ' + str(removed) + ' old ones removed. ' + str(len(Z.CASE_FIELDS)) +
            ' fields written, no location.')
    else:
        say('      No cases table given: not changed.')
    say('      Also saved: ' + csv_path + ' (the same rows and ' + str(len(Z.CASE_FIELDS)) +
        ' columns; a copy for your records, nothing to upload).')


def replace_zones(zones_src, res, say):
    """The zones as polygons in the layer's own coordinate system: the dashboard's circles, made in WGS 84 and
    projected; the control ring the 10 km circle less the 3 km one."""
    target_sr = arcpy.Describe(zones_src).spatialReference
    wgs84 = arcpy.SpatialReference(WGS84)
    names = dict((f.name.lower(), f.name) for f in arcpy.ListFields(zones_src))
    fields = ['SHAPE@'] + [names[n.lower()] for n, _, _ in Z.ZONE_FIELDS]

    def polygon(ring):
        return arcpy.Polygon(arcpy.Array([arcpy.Point(x, y) for x, y in ring]), wgs84)

    rows = []
    # The zones the public sees first, then the others, each in map order (south to north), not the table's: a zone's
    # place in the layer never matches its case's row in the public cases table, and the public view's row numbers
    # run on with no gaps where hidden zones would be.
    for z in sorted(res.zones, key=lambda z: (z['attributes']['Online_Live'] != 'Yes', z['case'].lat, z['case'].lon)):
        rings = z['rings']
        shape = polygon(rings[0]) if len(rings) == 1 else polygon(rings[0]).difference(polygon(list(reversed(rings[1]))))
        if target_sr.factoryCode != WGS84:
            shape = shape.projectAs(target_sr)
        rows.append([shape] + [z['attributes'][n] for n, _, _ in Z.ZONE_FIELDS])
    added, removed = replace(zones_src, fields, rows, 'zones', say)
    return str(added) + ' zones added, then the ' + str(removed) + ' old ones removed.'


class MakeStarter(object):
    def __init__(self):
        self.label = 'Make the starter file'
        self.description = ('Writes hpai_zones_starter.gdb: an empty zones layer (HPAI_Zones) and cases table '
                            '(HPAI_Cases) with the fields the rebuild tool writes. Publish each once from ArcGIS Pro '
                            '(Share > Web Layer), as step 2 of the build directions says.')
        self.canRunInBackground = False

    def getParameterInfo(self):
        folder = arcpy.Parameter(displayName='Folder for the starter file', name='folder', datatype='DEFolder',
                                 parameterType='Required', direction='Input')
        return [folder]

    def isLicensed(self):
        return True

    def updateParameters(self, parameters):
        return

    def updateMessages(self, parameters):
        folder = parameters[0]
        if folder.valueAsText and arcpy.Exists(os.path.join(folder.valueAsText, 'hpai_zones_starter.gdb')):
            folder.setErrorMessage('hpai_zones_starter.gdb is already in this folder: pick another folder, or delete '
                                   'the old one first.')
        return

    def execute(self, parameters, messages):
        folder = parameters[0].valueAsText
        arcpy.management.CreateFileGDB(folder, 'hpai_zones_starter.gdb')
        gdb = os.path.join(folder, 'hpai_zones_starter.gdb')
        arcpy.management.CreateFeatureclass(gdb, 'HPAI_Zones', 'POLYGON', spatial_reference=arcpy.SpatialReference(WEB_MERCATOR))
        zones = os.path.join(gdb, 'HPAI_Zones')
        for name, kind, length in Z.ZONE_FIELDS:
            arcpy.management.AddField(zones, name, kind, field_length=length)
        arcpy.management.CreateTable(gdb, 'HPAI_Cases')
        cases = os.path.join(gdb, 'HPAI_Cases')
        for label, name, kind in Z.CASE_FIELDS:
            arcpy.management.AddField(cases, name, kind, field_length=255 if kind == 'TEXT' else None, field_alias=label)
        arcpy.AddMessage('Made ' + gdb + ': HPAI_Zones (' + ', '.join(n for n, _, _ in Z.ZONE_FIELDS) + ') and '
                         'HPAI_Cases (' + ', '.join(n for _, n, _ in Z.CASE_FIELDS) + ').')
        arcpy.AddMessage('Next: publish each from ArcGIS Pro (Share > Web Layer), as step 2 of the build directions says.')
