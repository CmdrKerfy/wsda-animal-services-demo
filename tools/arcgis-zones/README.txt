HPAI ZONES TOOL (ArcGIS Pro)
============================

What it does
  Rebuilds the public HPAI map's zones and the cases table from the agreed
  HPAI table, the same .csv file the Emergency dashboard reads. Each run:
  - works out which cases are active or closed on today's date, by the
    same rules as the Emergency dashboard and its HPAI update;
  - draws every case's zones: a 3 km infection zone and a 3 to 10 km
    control ring around its map point, with the whole notice (302
    characters; today's map cuts it at 254);
  - replaces everything in the zones layer and in the cases table (nine
    fields, no location);
  - prints a check to compare with the update: cases, active, counties
    affected, active surveillance areas, and the rows to fix.
  Nothing has to be closed by hand, and no zone is ever doubled.

What it never does
  - It never reads the Premises, Address or City columns (or any column
    whose name has "address", "location", "street" or "premise" in it).
  - It never writes to today's public zones layer: it writes only to a
    layer with the new layer's exact fields, and refuses any other.
  - It never passes anything through a shapefile.
  - It never changes the HPAI table itself.

The files
  HPAI_Zones.pyt    the toolbox (add it in ArcGIS Pro's Catalog pane)
  zone_rules.py     the rules; keep it in the same folder as the toolbox
  README.txt        this note
  tests\            the tests (made-up tables only; in the release repository,
                    not in the ZIP; not needed to run it)

Once: the new layers
  1. In ArcGIS Pro: Catalog pane > Toolboxes > Add Toolbox > HPAI_Zones.pyt.
  2. Run "Make the starter file" into a folder on the R drive. It writes
     hpai_zones_starter.gdb with an empty zones layer (HPAI_Zones) and an
     empty cases table (HPAI_Cases), their fields already set up.
  3. Add HPAI_Zones to a map, then Share > Web Layer (Feature), title
     "WSDA HPAI Zones (source)", shared with no one. On its item page >
     Settings, tick Enable editing (Add, Update and Delete), so the tool can
     replace its contents. Do the same for HPAI_Cases, "WSDA HPAI Cases
     (source)".
  4. Make each one's public view (Create View Layer) with only the public
     fields; filter the zones view to Online_Live = 'Yes', so the public
     sees one set of zones per map point. Only the views are shared with
     everyone.

Each month
  1. Save the updated HPAI table as .csv (an Excel copy: File > Save As >
     CSV).
  2. Open "Rebuild the HPAI zones and cases table":
       HPAI table ............ the .csv
       Zones layer ........... WSDA HPAI Zones (source)
       Cases table ........... WSDA HPAI Cases (source)
       Active on ............. leave blank (today)
       Additional information  only if a note should show in the pop-ups
       Folder ................ leave blank (the table's folder), or pick one
       Check only ............ ticked (it is ticked each time it opens)
     A yellow warning under the table's box names rows whose coordinates
     need fixing, before anything runs.
  3. Run. Read the check in the messages. Fix what "TO FIX IN THE TABLE"
     lists, if anything, and run again.
  4. Untick "Check only" and run again. The tool:
       - saves a copy of what the layers held (hpai_zones_before_<date>.gdb);
       - adds the new zones, then removes the old ones;
       - does the same for the cases table.
     The public map and dashboard follow by themselves.
  5. Each run also saves, in the folder: the check as
     hpai_zones_check_<date>.txt, and hpai-cases-public.csv (the cases
     table's nine columns, for a first upload). A case detected after today
     (a date typed wrongly) is left out of the cases table and its file, and
     the check lists it to fix.

What the check says
  Cases                       every row detected on or before the date
  Active                      the active ones, by kind ("2 flocks, 1 dairy
                              herd")
  Counties affected           Washington's counties among the cases
  Active surveillance areas   active cases with a map point (each has zones)
  TO FIX IN THE TABLE         rows to fix, each by its line in the file and
                              its Case ID: coordinates that are swapped, not
                              a number or half missing (no zones until
                              fixed); coordinates outside Washington (drawn;
                              check them); dates that could not be read; a
                              case detected after today; a Quarantine
                              Release later than today; a County that is not
                              one of Washington's 39; an inventory that is
                              not a whole number.
  The numbers match the Emergency dashboard's Report view for the same table
  and date. One difference: a case with a map point but no County counts as
  "county not given" here (the dashboard takes the county its point is in).

The rules, in short
  - A case is closed when its Close Date is on or before the date; without
    one, when Status says closed and its Quarantine Release is on or before
    the date (a release later than today does not count); without either,
    when Status says closed. Every other case is active.
  - A case without a usable map point gets no zones; it still counts.
  - Two or more cases at the same map point (the same coordinates to about
    1 meter: a premises detected again): every case's zones are written,
    and the public sees one set (Online_Live = Yes): the latest active
    case's, or with none active the latest closed case's. The others have
    Online_Live = No. The public view's filter is Online_Live = 'Yes'.
  - Closed sites keep their zones (Closed_Site = Yes), shown faded on the
    map.

If it stops
  "STOPPED: ... Nothing changed." means nothing was written: the message says
  why (the wrong layer, a field missing or too short, a table with no rows or
  no map points). Fix that and run again.
  "FAILED while adding ...": the rows added were removed again, so the layer
  is as it was before the run. Run again. The copy made at the start is in
  the folder in any case.

For the developer
  The rules are site/emergency/rules.js and report.js written again in
  Python (zone_rules.py says which function each follows). The kinds of
  animal are a copy of site/emergency/types/hpai.js: change both together.
  The tests compare the tool with the dashboard row by row on the synthetic
  tables in test-tables/. From the repository's root:
    python3 -m unittest discover -s tools/arcgis-zones/tests -v
  (Python 3.9 or later and Node; tests/fake_arcpy stands in for ArcGIS.)
