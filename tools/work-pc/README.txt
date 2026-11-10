HPAI TABLE CHECK
================

What it does
  Shows the shape and the counts of an HPAI positives table, the way the
  Emergency Response page reads it, so a difference between the table and
  the page can be found without sending the table itself.

How to run it
  1. Unzip this ZIP into one folder (all three files together).
  2. Double-click CHECK_HPAI_TABLE.bat.
  3. In the file window, choose the HPAI table (the .csv the page reads).
  4. The report is shown in the window and saved in the same folder as
     hpai_table_check_YYYY-MM-DD.txt. The folder opens by itself.
  5. Read the report before sending it to anyone.

What the report holds (counts only)
  - the rows, and each column's name, what the page reads it as, and its
    blank cells (address and premises columns are never read);
  - the columns the page looks for and did not find;
  - each date column: how many read, how many not (shown by their form,
    such as "99.99.9999", never the date), the first and last year;
  - Flock/Herd Inventory and Depop Inventory added up over every row
    (mapped or not, every kind of animal), to compare with the HPAI
    update's "birds affected"
    (a total only; a cell that is not a whole number is left out and
    counted);
  - the category columns (status, subtype, flock type, production type,
    species, quarantine status): each value and its count, and how the
    page reads the status and quarantine values and each species' kind of
    animal ("Birds"; "Birds and Cattle" for a species naming both;
    "Other animals, not listed" for a species the page does not list).
    A value found in one row
    only, or one holding a date (in figures or with its month's name), a
    coordinate, a county's name or a Case ID, is shown by its shape (such as "aaaaa aaaa"), never as written;
  - how the County column is written (the forms, never the names: "Name",
    "name", "Name County");
  - the coordinates: how many mapped, and why the others are not;
  - what the page would show on the last detection date: active, closed,
    still under quarantine, not known, not mapped; and the closed positives
    by the day they close on the page: their Close Date, else their
    Quarantine Release date (one on or before the day the check is run),
    else a day not known (shown closed on every day); the three add up to
    every closed positive;
  - the same counts on the day the check is run, as the page opens: "On a
    day" on today and "Between dates" from the first detection to today
    (a closed date or a release date after the last detection counts
    here, not above).

What it never does
  - It never changes or copies the table, and opens nothing else.
  - The report never holds a Case ID, a name, an address, a coordinate, a
    county's name or a full date from the table (only today's date, which
    is not from the table).
  - It installs nothing and sends nothing anywhere. It needs R (the same R
    the CVI tools use); base R only, no packages.

The files
  CHECK_HPAI_TABLE.bat   double-click this
  check_hpai_table.R     the check itself (read by the .bat)
  README.txt             this note
