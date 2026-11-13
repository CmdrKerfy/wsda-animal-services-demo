# -*- coding: utf-8 -*-
"""
A stand-in for ArcGIS's arcpy, just enough for HPAI_Zones.pyt to run outside ArcGIS in test_toolbox.py. Layers and
tables are dicts in DATA (path -> fields and rows); messages are kept in MESSAGES. It checks the toolbox's own steps
(what it reads, what it writes and in which order, what it refuses), not ArcGIS: that test is the work PC's.
"""

import copy
import os
import re

DATA = {}        # path -> {'fields': [(name, type, length)], 'rows': {oid: {field: value}}, 'sr': code, 'next': oid,
                 #          'fail_after': None or how many inserts succeed before one fails}
LAYERS = {}      # a layer's name in a map -> its data's path (Describe(layer).catalogPath)
QUERIES = {}     # a layer's name -> its definition query, as a test on a row: a cursor on the layer sees only those
MESSAGES = []    # (level, text)
SYSTEM = [('OBJECTID', 'OID', 4)]


def reset():
    DATA.clear()
    LAYERS.clear()
    QUERIES.clear()
    del MESSAGES[:]


def add(path, fields, rows=(), sr=3857, shape=True):
    """A layer (shape=True) or table at path, with its fields and rows (dicts)."""
    DATA[path] = {'fields': list(fields), 'rows': {}, 'sr': sr, 'next': 1, 'fail_after': None, 'shape': shape}
    for r in rows:
        DATA[path]['rows'][DATA[path]['next']] = dict(r)
        DATA[path]['next'] += 1


def AddMessage(t):
    MESSAGES.append(('info', t))


def AddWarning(t):
    MESSAGES.append(('warning', t))


def AddError(t):
    MESSAGES.append(('error', t))


def _path(p):
    return LAYERS.get(p, p)


class Field(object):
    def __init__(self, name, type_, length):
        self.name, self.type, self.length = name, type_, length


def ListFields(p):
    d = DATA[_path(p)]
    extra = [('Shape', 'Geometry', 0), ('Shape__Area', 'Double', 8), ('Shape__Length', 'Double', 8)] if d['shape'] else []
    return [Field(*f) for f in SYSTEM + extra + d['fields']]


class SpatialReference(object):
    def __init__(self, code):
        self.factoryCode = code


class Describe(object):
    def __init__(self, p):
        self.catalogPath = _path(p)
        self.spatialReference = SpatialReference(DATA[self.catalogPath]['sr'])
        self.OIDFieldName = 'OBJECTID'


def AddFieldDelimiters(ds, f):
    return f


def Exists(p):
    return p in DATA or os.path.exists(p)


class Point(object):
    def __init__(self, x, y):
        self.X, self.Y = x, y


class Array(list):
    pass


class Polygon(object):
    """Rings as lists of (x, y); the spatial reference's code."""

    def __init__(self, array, sr=None, rings=None):
        self.rings = rings if rings is not None else [[(p.X, p.Y) for p in array]]
        self.sr = sr.factoryCode if sr else None

    def difference(self, other):
        return Polygon(None, SpatialReference(self.sr), self.rings + [list(reversed(other.rings[0]))])

    def projectAs(self, sr):
        return Polygon(None, sr, copy.deepcopy(self.rings))


class Parameter(object):
    def __init__(self, displayName=None, name=None, datatype=None, parameterType=None, direction=None):
        self.displayName, self.name, self.datatype = displayName, name, datatype
        self.parameterType, self.direction = parameterType, direction
        self.value = None
        self.filter = type('Filter', (), {'list': []})()
        self.error = self.warning = None

    @property
    def valueAsText(self):
        return None if self.value is None else str(self.value)

    def setErrorMessage(self, t):
        self.error = t

    def setWarningMessage(self, t):
        self.warning = t


class ExecuteError(Exception):
    pass


def _where(where):
    m = re.match(r'^OBJECTID IN \(([\d,]+)\)$', where or '')
    return set(int(n) for n in m.group(1).split(',')) if m else None


class _Cursor(object):
    def __init__(self, p, fields, where=None):
        self.d, self.fields, self.only = DATA[_path(p)], fields, _where(where)
        self.query = QUERIES.get(p, lambda row: True)

    def _seen(self, oid):
        return (self.only is None or oid in self.only) and self.query(self.d['rows'][oid])

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def _value(self, oid, row, f):
        return oid if f == 'OID@' else row.get(f)


class SearchCursor(_Cursor):
    def __iter__(self):
        for oid, row in list(self.d['rows'].items()):
            if self._seen(oid):
                yield tuple(self._value(oid, row, f) for f in self.fields)


class UpdateCursor(SearchCursor):
    def __iter__(self):
        for oid in [o for o in list(self.d['rows']) if self._seen(o)]:
            self.current = oid
            yield tuple(self._value(oid, self.d['rows'][oid], f) for f in self.fields)

    def deleteRow(self):
        del self.d['rows'][self.current]


class InsertCursor(_Cursor):
    def insertRow(self, row):
        if self.d['fail_after'] is not None:
            if self.d['fail_after'] == 0:
                raise RuntimeError('made-up failure: the connection dropped')
            self.d['fail_after'] -= 1
        oid = self.d['next']
        self.d['next'] += 1
        self.d['rows'][oid] = dict(zip(self.fields, row))
        return oid


class da(object):
    SearchCursor = SearchCursor
    UpdateCursor = UpdateCursor
    InsertCursor = InsertCursor


class management(object):
    @staticmethod
    def CreateFileGDB(folder, name):
        os.makedirs(os.path.join(folder, name))

    @staticmethod
    def CopyFeatures(src, dst):
        DATA[dst] = copy.deepcopy(DATA[_path(src)])

    CopyRows = CopyFeatures

    @staticmethod
    def CreateFeatureclass(path, name, geometry_type, spatial_reference=None):
        add(os.path.join(path, name), [], sr=spatial_reference.factoryCode)

    @staticmethod
    def CreateTable(path, name):
        add(os.path.join(path, name), [], shape=False)

    @staticmethod
    def AddField(p, name, kind, field_length=None, field_alias=None):
        types = {'TEXT': 'String', 'DATE': 'Date', 'LONG': 'Integer'}
        DATA[p]['fields'].append((name, types[kind], field_length or 0))
