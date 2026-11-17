HPAI ZONES TOOL (ArcGIS Pro)
============================

The table
  The agreed HPAI table, saved as .csv. The tool finds its columns by name, in
  any order: Case ID, Date Reported, Close Date, Confirmed Diagnosis,
  Quarantine Release, Quarantine Status, Premises, Address, City, County,
  State, Latitude, Longitude, Status, Subtype, Flock/Herd Type, Production
  Type, Species, Flock/Herd Inventory, Depop Inventory, Structures, Disposal
  Method.
  The cases table (public through its view) holds eleven of them: Confirmed
  Diagnosis, Date Reported, Close Date, Quarantine Release, Quarantine Status,
  Status, County, State, Flock/Herd Type, Flock/Herd Inventory, Species, for
  the bird cases only (see "Birds only"). A cases table published before 2.9.1
  has nine: add Quarantine_Status and State as String fields (its item page >
  Data > Fields > Add), then tick both in its public view's fields (the view's
  item page > Visualization or Settings > Define view), so the public sees
  them. Publishing it again from a new starter file makes a new item instead:
  its public view must then be made again, and the dashboard's expression
  pointed at the new view's item ID.
  A zones layer published before 2.9.1 has no Animal field: add it to WSDA
  HPAI Zones (source) as a String field of 100 characters (the same place).
  Then check the zones view's fields (its item page > Data > Fields): Animal
  must not be among them; if it is, untick it (Visualization or Settings >
  Define view). The tool stops, with nothing written, until the field is
  there.

Birds only
  For now the public sees birds only (the Emergency dashboard, for staff,
  shows every animal). Each run writes every case's zones, but only bird
  cases' zones are shown to the public (Online_Live = Yes), and the cases
  table holds only the bird cases. A case of birds and another animal
  ("Cattle, Chicken") counts as birds. The check says how many cases of other
  animals were left out, and which. The setting is one line in zone_rules.py,
  PUBLIC_ANIMALS; a slip in it stops a real run. To show other animals too,
  see "Showing other animals" below.

What it does
  Rebuilds the public HPAI map's zones and the cases table from the agreed
  HPAI table, the same .csv file the Emergency dashboard reads. Each run:
  - works out which cases are active or closed on today's date, by the
    same rules as the Emergency dashboard and its HPAI update;
  - draws every case's zones: a 3 km infection zone and a 3 to 10 km
    control ring around its map point, with the whole notice (302
    characters; today's map cuts it at 254) and its Animal;
  - replaces everything in the zones layer and in the cases table (eleven
    fields, no location; the bird cases only);
  - prints a check to compare with the update: cases, active, counties
    affected, active surveillance areas, and the rows to fix.
  Nothing has to be closed by hand, and the public never sees a zone twice
  (one set at each map point).

What it never does
  - It never keeps, writes or shows the Premises, Address or City columns
    (or any column whose name has "address", "location", "street" or
    "premise" in it); a cell is only checked for a stray quote mark.
  - It never writes to today's public zones layer: it writes only to a
    layer with the new layer's exact fields, and refuses any other.
  - It never writes to a file with those fields (the starter file, a copy):
    only to an online layer, its address shown in the messages.
  - It never passes anything through a shapefile.
  - It never changes the HPAI table itself.

The files
  HPAI_Zones.pyt    the toolbox (add it in ArcGIS Pro's Catalog pane)
  zone_rules.py     the rules; keep it in the same folder as the toolbox
  README.txt        this note
  tests\            the tests (made-up tables only; in the release repository,
                    not in the ZIP; not needed to run it)
  Keep the tool's folder editable only by the HPAI group: whoever can
  change these files changes what runs with your ArcGIS Online sign-in.
  Keep the folder the tool writes to (its backups, check files and
  hpai-cases-public.csv) for the HPAI group too: the backups hold every
  animal's zones.

Once: the new layers
  1. In ArcGIS Pro: a new project saved in the tool's folder, then Catalog
     pane > right-click Toolboxes > Add Toolbox > HPAI_Zones.pyt. Save the
     project and open it each time (the build directions' step 1).
  2. Run "Make the starter file" into a folder on the R drive. It writes
     hpai_zones_starter.gdb with an empty zones layer (HPAI_Zones) and an
     empty cases table (HPAI_Cases), their fields already set up.
  3. Add HPAI_Zones to a map, then Share > Web Layer (Feature), title
     "WSDA HPAI Zones (source)", shared with no one. On its item page >
     Settings, tick Enable editing (Add, Update and Delete), so the tool can
     replace its contents. Do the same for HPAI_Cases, "WSDA HPAI Cases
     (source)".
  4. Make each one's public view (Create View Layer) with only the public
     fields (not Animal); filter the zones view to Online_Live = 'Yes', so
     the public sees one set of zones per map point, birds only. Only the
     views are shared with everyone.

Each month
  1. The HPAI table is already a .csv: after editing it in Excel, select
     Latitude and Longitude > Home > Increase Decimal until 5 decimals show,
     then save (Ctrl+S, Keep Current Format) and close it.
  2. Open "Rebuild the HPAI zones and cases table":
       HPAI table ............ the .csv
       Zones layer ........... WSDA HPAI Zones (source), the online one
       Cases table ........... WSDA HPAI Cases (source), the online one
       Active on ............. leave blank (today)
       Additional information  only if a note should show in every public
                               pop-up (never a name or an address)
       Folder ................ the HPAI zones folder (required)
       Check only ............ ticked (it is ticked each time it opens)
     A yellow warning under the table's box names rows whose coordinates,
     dates or Species need a look, and a red one under a box that cannot be
     used, before anything runs.
  3. Run. Read the check in the messages. Fix what "TO FIX IN THE TABLE"
     lists, if anything, and run again; a row that is right as it is can stay
     (only "A REAL RUN WILL STOP" must be fixed). Dates: M/D/YYYY (3/10/2022)
     or YYYY-MM-DD (2022-03-10). Latitude and Longitude: format both columns
     to show 5 decimals before saving (Excel saves what the cell shows).
  4. Untick "Check only" and run again. The tool:
       - saves a copy of what the layers held (hpai_zones_before_<date>.gdb);
       - adds the new zones, then removes the old ones;
       - does the same for the cases table.
     The public map and dashboard follow by themselves.
  5. Each run also saves, in the folder: the check as
     hpai_zones_check_<date>.txt (every list in full: the messages name ten
     rows, then "and N more"), and hpai-cases-public.csv (the cases table's
     rows and eleven columns; a copy for your records, nothing to upload). A
     case detected after today (a date typed wrongly) is left out of the
     cases table and its file, and the check lists it to fix.

What the check says
  Cases                       every row detected on or before the date
  Active                      the active ones, by kind ("2 flocks, 1 dairy
                              herd"; flocks are Birds, dairy herds Cattle)
  Counties affected           Washington's counties among the cases
  Active surveillance areas   active cases with a map point (each has zones),
                              then by animal and how many are on the public
                              map
  Each of the first three also gives the public dashboard's number (birds
  only): compare the dashboard's tiles with that one. In the by-animal
  numbers a case naming two kinds counts in both, so they can add up to more
  than the total.
  TO FIX IN THE TABLE         rows to fix, each by its row in Excel and
                              its Case ID: coordinates that are swapped, not
                              a number, half missing, a 0, or with a
                              minus sign missing or extra (no zones until
                              fixed); coordinates outside Washington or with
                              fewer than 4 decimals (drawn; check them); a
                              cell holding several lines (a stray quote
                              mark); a Species, Status or Flock/Herd Type
                              over 40 characters (public as written); dates
                              that could not be read; a case detected after
                              today; a Quarantine
                              Release later than today; a County that is not
                              one of Washington's 39; a State that is not
                              Washington; a Quarantine Status other than
                              "Under quarantine" or "Released"; an inventory
                              that is not a whole number; a Species the tool
                              does not recognize; a Species naming two kinds;
                              a blank Species (see "Species" below).
  The numbers match the Emergency dashboard's Report view for the same table
  and date. One difference: a case with a map point but no County counts as
  "county not given" here (the dashboard takes the county its point is in).

Species
  Each zone's Animal field (for staff; the public view leaves it out) says
  which animals its case had: Birds, Cattle, Other animals, or two joined
  ("Birds, Cattle"). It comes from Species by the same word list as the
  Emergency dashboard: Poultry, Chicken, Duck, Goose, Turkey, Flock and other
  bird words are Birds ("Multiple Poultry Species" too); Cattle, Dairy, Cow,
  Beef and Holstein are Cattle; Goat, Sheep, Swine and others are Other
  animals. A word counts at the start of a word in Species, in any capitals.
  Flock counts only when no other animal is named: "Backyard flock" is Birds,
  "Sheep flock" is Other animals.
  - A blank Species counts as Birds, and so does Unknown, Unknown species, N/A,
    TBD, Not known, Unk, - or ? (the whole Species, nothing else in it).
    These are on the public map: if the case is not birds, fill in Species
    before a real run. The check lists them. Where Flock/Herd Type or
    Production Type names another animal ("Commercial Dairy"), a real run
    stops until Species is filled in (Production Type is read only for
    this; it is never written or shown).
  - A Species the tool does not recognize (a typing slip such as "Chiken",
    or an animal not on the list) counts as Other animals, so it is not on
    the public map. The check lists it with what was typed: fix the
    spelling, or ask whoever looks after the tool to add the word.
  - A Species naming two kinds ("Cattle, Chicken") counts as both, so it is
    on the public map as birds. The check lists it: make sure it names the
    animals, not a farm ("Sample Eagle Dairy" would read as birds and
    cattle).
  - A word in Species that is not an animal (a farm's name or a place,
    "Swanson Farms") goes public as written: the check lists it to check.
    A digit in Species or Flock/Herd Type (an address or a phone number?)
    stops a real run until it is taken out.
  - A table with no Species column (renamed or deleted), or one blank in
    every row, would put every case on the public map as birds: a real run
    stops until it is fixed, and hpai-cases-public.csv is not written.

The rules, in short
  - A case is closed when its Close Date is on or before the date; without
    one, when Status says closed and its Quarantine Release is on or before
    the date (a release later than today does not count); without either,
    when Status says closed. Every other case is active.
  - A case without a usable map point gets no zones; it still counts.
  - Two or more cases at the same map point (the same coordinates to about
    1 meter: a premises detected again): every case's zones are written,
    and the public sees one set there (Online_Live = Yes), among the bird
    cases: the latest active one's, or with none active the latest closed
    one's. So the public map still shows a flock at a point where a dairy
    herd was found later. A point with no bird case shows nothing. The
    others have Online_Live = No. The public view's filter is Online_Live =
    'Yes'.
  - Closed sites keep their zones (Closed_Site = Yes), shown faded on the
    map.

If it stops
  "STOPPED: ... Nothing changed." means nothing was written: the message says
  why (the wrong layer, a file instead of the online layer, a field missing
  or too short, a table with no rows or no map points, a file Excel has open,
  a table the tool cannot read). Fix that and run again.
  A real run (Check only unticked) also stops, with nothing written, for a
  Close Date it cannot read (a closed site would show as open), for a table
  with no Species column or one blank in every row (every case would show as
  birds), for a blank Species where the type names another animal, for a digit
  in Species or Flock/Herd Type, for a PUBLIC_ANIMALS it cannot use, and for a
  value too long or too large for its field (the write would fail every time).
  Check only lists them under "A REAL RUN WILL STOP".
  "FAILED while adding ...": the rows added were removed again, so that layer
  is as it was before the run; the message says if the zones layer was
  already rewritten. The copies made at the start are in the folder.

Showing other animals
  Only when it has been decided (and the records officer asked) that the
  public may see another kind of animal. The developer changes one line in
  zone_rules.py, near the top:
    PUBLIC_ANIMALS = ('birds',)     becomes   ('birds', 'cattle')
  then the tool is copied to the work PC again, and a Check only run, then a
  real run, are done. That run shows the cattle cases' zones and puts the
  cattle rows in the cases table. The public dashboard then needs:
  - the Status banner's and Cases in Washington's is_bird filters checked
    (they count birds only, as the update does);
  - the Livestock cases tile, kept here for that day: Indicator, Sum of
    active_cattle, bottom text "active cattle cases", beside the Livestock
    text;
  - the What is public page and its signed-out checks done again.

For the developer
  The rules are site/emergency/rules.js and report.js written again in
  Python (zone_rules.py says which function each follows). The kinds of
  animal are a copy of site/emergency/types/hpai.js: change both together
  (the tests check they match), and the public dashboard's counting rules
  and tools/work-pc/check_hpai_table.R keep copies too. BLANK_SPECIES is a
  copy of rules.js's.
  Adding a kind of animal: add it to KINDS and ANIMAL_NAMES here and to
  hpai.js (site/emergency/changing-kinds.html), keeping "other" last (a
  Species no word names counts there); check the Animal field's length (the
  check says what it needs); the public sees it only when it is added to
  PUBLIC_ANIMALS.
  The tests compare the tool with the dashboard row by row on the synthetic
  tables in test-tables/. From the repository's root:
    python3 -m unittest discover -s tools/arcgis-zones/tests -v
  (Python 3.9 or later and Node; tests/fake_arcpy stands in for ArcGIS.)
