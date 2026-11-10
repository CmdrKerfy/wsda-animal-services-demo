# HPAI table check: the shape and the counts of an HPAI positives table, as the Emergency Response page reads it.
#
# Run by CHECK_HPAI_TABLE.bat beside it (double-click), or by hand:
#   Rscript --vanilla check_hpai_table.R <the table .csv> [<the report .txt>] [<a day, YYYY-MM-DD>]
# The report goes to the second path, else to hpai_table_check_YYYY-MM-DD.txt beside this script. It is printed in
# the window too. The third, for the project's tests, is the day the page is taken to be opened on, in place of today.
#
# Base R only: no packages, nothing installed. The table is only read: never changed, never copied. Nothing else is
# opened and nothing is sent anywhere.
#
# The report holds only the table's shape and counts: never a Case ID, a name, an address, a coordinate, a county's
# name or a full date from the table. The columns' names are shown (unless the first row does not look like the
# header) and the values of the category columns (status, subtype, flock type and the like), as these are category
# words; a column with many different values, or a long value, is counted, not listed. A value found in one row
# only (other than a status, closed or quarantine word), or one holding a date, a coordinate, a county's name or a
# Case ID, is shown by its shape (each letter an a, each digit a 9), as is a column name of that kind. Flock/Herd
# Inventory and Depop Inventory are added up over every row (2.8), to compare with the HPAI update's "birds affected".
#
# The page's rules are written again here, from site/emergency/rules.js, types.js and types/hpai.js and the CSV
# reader site/cvi/app/csv.js: the columns it reads (the first name the file has wins, any case; a name holding
# address, location, street or premise is never read), the dates it reads (YYYY-MM-DD, YYYY/M/D or M/D/YYYY, a time
# after them ignored), the coordinates it maps, and each positive's group (active, closed, still under quarantine,
# not known, not mapped) on the last detection date and on the day the check is run, as the page opens (2.5: "On a
# day" on today, "Between dates" from the first detection to today). The project's unit suite runs this script on the
# synthetic tables and compares its counts with the page's.

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 1 || !nzchar(args[1])) {
  cat("Usage: Rscript --vanilla check_hpai_table.R <the table .csv> [<the report .txt>] [<a day, YYYY-MM-DD>]\n")
  quit(save = "no", status = 2)
}
table_path <- args[1]
here <- local({
  a <- commandArgs(trailingOnly = FALSE)
  f <- sub("^--file=", "", a[grep("^--file=", a)])
  if (length(f)) dirname(normalizePath(f[1])) else getwd()
})
today <- format(Sys.Date(), "%Y-%m-%d")
report_path <- if (length(args) >= 2 && nzchar(args[2])) args[2] else
  file.path(here, paste0("hpai_table_check_", today, ".txt"))

# ---- The page's settings (types/hpai.js, types.js, rules.js) -----------------------------------------------------

# The column names for each role, in order of preference. id, detected and the rest from types/hpai.js; lat, lon,
# county and species from rules.js (every type).
ROLE_NAMES <- list(
  id = c("Case ID", "AnimalDiseaseReportId"),
  detected = c("Confirmed Diagnosis", "Date Reported", "Detection Date"),
  disease = c("Subtype", "Disease Name"),
  status = c("Case Status"),
  quarantine = c("Quarantine Release"),
  quarantineStatus = c("Quarantine Status"),
  closed = c("Status", "Surveillance Closed"),
  closedDate = c("Close Date"),
  flockType = c("Flock/Herd Type"),
  inventory = c("Flock/Herd Inventory"),
  shown = c("Production Type"),
  lat = c("case lat", "lat", "latitude", "y"),
  lon = c("case long", "long", "lon", "lng", "longitude", "x"),
  county = c("county"),
  species = c("species", "species group"))
# How the report names each role.
ROLE_WORDS <- c(id = "the positive's ID", disease = "the disease", status = "testing status",
  quarantine = "quarantine released", quarantineStatus = "quarantine status", closed = "closed or not",
  closedDate = "surveillance ended", flockType = "flock type", inventory = "animals", shown = "shown in the hover",
  lat = "latitude", lon = "longitude", county = "county", species = "animal kind")
PRIVATE <- "address|location|street|premise"
# The testing statuses (a file without the status column gives every positive the first).
STATUSES <- list(Confirmed = c("confirmed", "positive"), Presumptive = c("presumptive", "presumptive positive"),
  Suspect = c("suspect", "suspected", "pending"))
CLOSED_VALUES <- c("closed", "yes", "y", "true", "1")
QUARANTINE_UNDER <- c("under quarantine", "quarantined", "in quarantine")
QUARANTINE_RELEASED <- c("released", "lifted")
# The kinds of animal (types/hpai.js kinds, 2.8): each kind's label and species words, in order. A species is every
# kind with a word at the start of one of its words ("Cattle, Chicken" is "Birds and Cattle"), except a word inside a
# longer word of another kind ("Pigeon" is birds, not a pig); no species, the first kind; a species no kind names, the
# last kind, "not listed".
KINDS <- list(
  Birds = c("poultry", "chicken", "turkey", "duck", "goose", "geese", "bird", "avian", "layer", "broiler", "gamebird", "pigeon",
    "dove", "waterfowl", "fowl", "peafowl", "pheasant", "quail", "chukar", "grouse", "partridge", "emu", "ostrich",
    "rhea", "swan", "gull", "hawk", "eagle", "owl", "falcon", "raptor", "crow", "raven", "magpie", "heron", "egret",
    "pelican", "cormorant", "songbird", "parrot", "finch", "sparrow", "hen"),
  Cattle = c("cattle", "dairy", "bovine", "cow", "heifer", "steer", "calf", "calves", "beef"),
  `Other animals` = c("goat", "caprine", "sheep", "ovine", "swine", "hog", "porcine", "pig", "alpaca", "llama",
    "camelid", "horse", "equine", "mink", "cat", "feline", "dog", "canine", "seal", "sea lion", "fox", "raccoon",
    "skunk", "bear", "ferret", "rabbit", "deer", "elk", "wolf", "dolphin", "porpoise"))
# Washington's box, a little wide (rules.js): a pair unusable as written that falls in it the other way round looks
# swapped; a mapped pair outside it is counted (a pair just over the border, in Oregon say, is inside it).
WA <- c(south = 45.5, north = 49.1, west = -124.9, east = -116.9)
WA_COUNTIES <- c("Adams", "Asotin", "Benton", "Chelan", "Clallam", "Clark", "Columbia", "Cowlitz", "Douglas", "Ferry",
  "Franklin", "Garfield", "Grant", "Grays Harbor", "Island", "Jefferson", "King", "Kitsap", "Kittitas", "Klickitat",
  "Lewis", "Lincoln", "Mason", "Okanogan", "Pacific", "Pend Oreille", "Pierce", "San Juan", "Skagit", "Skamania",
  "Snohomish", "Spokane", "Stevens", "Thurston", "Wahkiakum", "Walla Walla", "Whatcom", "Whitman", "Yakima")
# A category column with more different values than this, or a value longer than this, is counted, not listed.
MAX_VALUES <- 25
MAX_VALUE_CHARS <- 40
# A category value found in fewer rows than this is shown by its shape, unless it is one of the words below: a value
# in one row is more likely a name or a note typed into the column than a category word.
MIN_ROWS <- 2
# The words a status, closed or quarantine column is expected to hold (the page's, and the usual opposites), shown
# as written however few rows hold them.
KNOWN_WORDS <- c(unlist(STATUSES, use.names = FALSE), CLOSED_VALUES, "open", "no", "n", "false", "0",
  QUARANTINE_UNDER, QUARANTINE_RELEASED)

# ---- Reading the file as the page does ---------------------------------------------------------------------------

# The bytes as text: UTF-8, its byte-order mark dropped; bytes that are not UTF-8 are replaced, as a browser does,
# and the report says so.
read_text <- function(path) {
  size <- file.info(path)$size
  if (is.na(size)) stop("the file could not be opened")
  bytes <- readBin(path, "raw", n = size)
  bytes <- bytes[bytes != as.raw(0)]
  txt <- rawToChar(bytes)
  Encoding(txt) <- "UTF-8"
  utf8 <- validUTF8(txt)
  if (!utf8) txt <- iconv(txt, from = "UTF-8", to = "UTF-8", sub = "\uFFFD")
  if (startsWith(txt, "\uFEFF")) txt <- substring(txt, 2)
  list(text = txt, utf8 = utf8)
}

# site/cvi/app/csv.js, step by step: quoted cells keep commas, quotes ("") and line breaks; characters after a closing
# quote are kept; unquoted cells are trimmed and "" or NA is blank (NA here); trailing blank rows are dropped.
parse_csv <- function(txt) {
  ch <- strsplit(txt, "")[[1]]
  n <- length(ch)
  rows <- list()
  row <- character(0)
  i <- 1
  stop_at <- function(j) { while (j <= n && ch[j] != "," && ch[j] != "\n" && ch[j] != "\r") j <- j + 1; j }
  repeat {
    if (i <= n && ch[i] == "\"") {
      i <- i + 1
      buf <- character(0)
      repeat {
        if (i > n) break
        if (ch[i] == "\"") {
          if (i + 1 <= n && ch[i + 1] == "\"") { buf <- c(buf, "\""); i <- i + 2; next }
          i <- i + 1
          break
        }
        buf <- c(buf, ch[i]); i <- i + 1
      }
      j <- stop_at(i)
      if (j > i) buf <- c(buf, ch[i:(j - 1)])
      i <- j
      cell <- paste(buf, collapse = "")
    } else {
      j <- stop_at(i)
      cell <- if (j > i) trimws(paste(ch[i:(j - 1)], collapse = ""), whitespace = "[\\h\\v]") else ""
      i <- j
      if (cell == "" || cell == "NA") cell <- NA_character_
    }
    row <- c(row, cell)
    if (i > n) { rows[[length(rows) + 1]] <- row; break }
    if (ch[i] == ",") { i <- i + 1; next }
    if (ch[i] == "\r" && i + 1 <= n && ch[i + 1] == "\n") i <- i + 1
    i <- i + 1
    rows[[length(rows) + 1]] <- row
    row <- character(0)
    if (i > n) break
  }
  while (length(rows) && all(is.na(rows[[length(rows)]]))) rows[[length(rows)]] <- NULL
  header <- if (length(rows)) ifelse(is.na(rows[[1]]), "", rows[[1]]) else character(0)
  list(header = header, rows = rows[-1])
}

# A cell as the page reads it: trimmed, blank as "".
clean <- function(v) { v[is.na(v)] <- ""; trimws(v, whitespace = "[\\h\\v]") }

# The index of the first column with one of the names (any case), never a private one; NA when none.
column_index <- function(header, names) {
  lower <- tolower(clean(header))
  for (nm in names) {
    i <- match(tolower(nm), lower)
    if (!is.na(i) && !grepl(PRIVATE, header[i], ignore.case = TRUE)) return(i)
  }
  NA_integer_
}

# rules.js dateOf: YYYY-MM-DD, YYYY/M/D or M/D/YYYY, a time after it ignored, a real calendar day; as YYYY-MM-DD, else
# NA. Also the form it was written in.
ISO <- "^([0-9]{4})([-/])([0-9]{1,2})[-/]([0-9]{1,2})([ T].*)?$"
MDY <- "^([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})([ T].*)?$"
date_of <- function(v) {
  v <- clean(v)
  iso <- grepl(ISO, v, perl = TRUE)
  mdy <- !iso & grepl(MDY, v, perl = TRUE)
  y <- mo <- d <- rep(NA_integer_, length(v))
  y[iso] <- as.integer(sub(ISO, "\\1", v[iso], perl = TRUE))
  mo[iso] <- as.integer(sub(ISO, "\\3", v[iso], perl = TRUE))
  d[iso] <- as.integer(sub(ISO, "\\4", v[iso], perl = TRUE))
  y[mdy] <- as.integer(sub(MDY, "\\3", v[mdy], perl = TRUE))
  mo[mdy] <- as.integer(sub(MDY, "\\1", v[mdy], perl = TRUE))
  d[mdy] <- as.integer(sub(MDY, "\\2", v[mdy], perl = TRUE))
  out <- ifelse(iso | mdy, sprintf("%04d-%02d-%02d", y, mo, d), NA_character_)
  back <- suppressWarnings(format(as.Date(out, format = "%Y-%m-%d"), "%Y-%m-%d"))
  out[is.na(back) | back != out] <- NA_character_
  timed <- grepl("[ T].", v)
  form <- ifelse(iso, ifelse(sub(ISO, "\\2", v, perl = TRUE) == "-", "YYYY-MM-DD", "YYYY/M/D"),
    ifelse(mdy, "M/D/YYYY", NA_character_))
  form <- ifelse(!is.na(form) & timed, paste(form, "with a time"), form)
  list(date = out, form = form)
}

# The shape of a value that is not read: each digit as 9, each letter as a, other characters kept (so it shows how
# the value is written, never the value).
shape_of <- function(v) {
  s <- gsub("[A-Za-z]", "a", gsub("[0-9]", "9", clean(v)))
  ifelse(nchar(s) > 24, paste0(substr(s, 1, 24), "..."), s)
}

# proximity.js number: R's as.numeric reading (white space around allowed); NA otherwise.
number_of <- function(v) {
  s <- clean(v)
  out <- rep(NA_real_, length(s))
  dec <- grepl("^[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][+-]?[0-9]+)?$", s, perl = TRUE)
  out[dec] <- as.numeric(s[dec])
  hex <- grepl("^[+-]?0[xX][0-9a-fA-F]+$", s, perl = TRUE)
  out[hex] <- ifelse(startsWith(s[hex], "-"), -1, 1) * strtoi(sub("^[+-]?0[xX]", "", s[hex]), 16L)
  inf <- grepl("^[+-]?(inf|infinity)$", s, ignore.case = TRUE, perl = TRUE)
  out[inf] <- ifelse(startsWith(s[inf], "-"), -Inf, Inf)
  out
}
usable <- function(lat, lon) !is.na(lat) & !is.na(lon) & abs(lat) <= 90 & abs(lon) <= 180

# The day the page is taken to be opened on: today, or the third argument (the project's tests).
on_day <- if (length(args) >= 3 && nzchar(args[3])) date_of(args[3])$date else today
if (is.na(on_day)) {
  cat("The day must be written YYYY-MM-DD. Nothing was changed.\n")
  quit(save = "no", status = 2)
}

pad <- function(x, w) paste0(x, strrep(" ", pmax(0, w - nchar(x))))
plural <- function(n, one, many) paste(n, if (n == 1) one else many)

# ---- The report --------------------------------------------------------------------------------------------------

read <- tryCatch(read_text(table_path), error = function(e) NULL)
if (is.null(read)) {
  cat("The table could not be opened. Nothing was changed.\n")
  quit(save = "no", status = 1)
}
parsed <- parse_csv(read$text)
header <- parsed$header
ncol_h <- length(header)
cells <- function(r) { v <- r[seq_len(ncol_h)]; v[is.na(v)] <- ""; v }
data <- lapply(parsed$rows, cells)
blank_row <- vapply(data, function(r) all(clean(r) == ""), logical(1))
data <- data[!blank_row]
n_rows <- length(data)
grid <- if (n_rows) do.call(rbind, data) else matrix("", 0, ncol_h)
grid <- matrix(clean(grid), nrow = n_rows, ncol = ncol_h)
col_cells <- function(i) if (is.na(i)) rep("", n_rows) else grid[, i]

col <- lapply(ROLE_NAMES, function(names) column_index(header, names))
detected_at <- as.integer(unique(na.omit(vapply(ROLE_NAMES$detected, function(nm) column_index(header, nm), integer(1)))))
shown_at <- as.integer(unique(na.omit(vapply(ROLE_NAMES$shown, function(nm) column_index(header, nm), integer(1)))))
# The first row is taken as the header when it holds the name of a column the page needs, three letters or more: a
# one-letter name ("x", "y") could be a Yes/No cell of a table without its header row.
named <- function(names) !is.na(column_index(header, names[nchar(names) >= 3]))
looks_like_header <- named(ROLE_NAMES$lat) || named(ROLE_NAMES$lon) || named(ROLE_NAMES$id) ||
  any(vapply(ROLE_NAMES$detected, function(nm) named(nm), logical(1)))
# A cell that could be from a record, never shown as written: a date (in figures or with its month's name), a number like a coordinate (three decimals or
# more; a subtype such as 2.3.4.4b is kept), a county's name, or one of the table's Case IDs.
ids <- unique(col_cells(col$id)[col_cells(col$id) != ""])
county_word <- paste0("\\b(", paste(WA_COUNTIES, collapse = "|"), ")\\b")
# A date written with its month's name, either way round ("Oct 5, 2026", "5 October"); a month and year alone is not a
# day, so it may show.
month_day <- paste0("\\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+[0-9]{1,2}(st|nd|rd|th)?\\b|",
  "\\b[0-9]{1,2}(st|nd|rd|th)?\\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)")
looks_private <- function(v) {
  grepl("[0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4}|[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}|(^|[^0-9.])-?[0-9]{1,3}\\.[0-9]{3,}", v,
    perl = TRUE) | grepl(month_day, v, ignore.case = TRUE, perl = TRUE) | grepl(county_word, v, ignore.case = TRUE, perl = TRUE) |
    v %in% ids
}
column_name <- function(i) {
  if (!looks_like_header) return(paste("Column", i))
  h <- gsub("[[:cntrl:]]", " ", clean(header[i]))
  if (!nzchar(h)) "(no name)" else if (looks_private(h)) paste("Column", i, "(name not shown)")
  else if (nchar(h) > 30) paste0(substr(h, 1, 30), "...") else h
}
ordinal <- c("1st", "2nd", "3rd")

out <- c("HPAI TABLE CHECK (counts only: no Case ID, name, address, coordinate, county name or full date is shown)",
  paste0("Made ", today, ". The table was only read; nothing was changed or copied."), "")
if (!read$utf8) out <- c(out, "The file is not UTF-8: the page will say so (in Excel, use Save As, then CSV UTF-8).", "")
skipped <- sum(blank_row)
out <- c(out, paste0("Rows below the header: ", n_rows,
  if (skipped) paste0(" (", plural(skipped, "empty row", "empty rows"), " not counted, as the page skips them)") else ""),
  paste0("Columns: ", ncol_h))
if (!looks_like_header) {
  out <- c(out, "The first row does not look like the header (none of the columns the page reads were found),",
    "so the columns are shown by their place only. Check that the right table was picked.")
}

# Each column: its role and its blank cells.
roles_of <- function(i) {
  r <- character(0)
  for (k in names(col)) if (k != "detected" && k != "shown" && !is.na(col[[k]]) && col[[k]] == i) r <- c(r, ROLE_WORDS[[k]])
  if (i %in% detected_at) r <- c(r, paste0("detection date (", ordinal[match(i, detected_at)], ")"))
  if (i %in% shown_at) r <- c(r, ROLE_WORDS[["shown"]])
  if (length(r)) paste(r, collapse = ", ") else "not used"
}
w <- max(23, nchar(vapply(seq_len(ncol_h), column_name, character(1))) + 2)
out <- c(out, "", paste0(pad("Column", w), pad("Read by the page as", 25), "Blank cells"))
for (i in seq_len(ncol_h)) {
  private <- grepl(PRIVATE, header[i], ignore.case = TRUE)
  out <- c(out, paste0(pad(column_name(i), w), pad(if (private) "never read (private)" else roles_of(i), 25),
    if (private) "-" else sum(grid[, i] == "")))
}

# The columns the page looks for and did not find.
missing <- character(0)
for (k in names(ROLE_NAMES)) {
  found <- if (k == "detected") length(detected_at) > 0 else if (k == "shown") length(shown_at) > 0 else !is.na(col[[k]])
  if (!found) {
    word <- if (k == "detected") "detection date" else ROLE_WORDS[[k]]
    missing <- c(missing, paste0("  ", pad(word, 22), paste(ROLE_NAMES[[k]], collapse = ", "),
      if (k == "status") " (every positive shown as Confirmed)" else ""))
  }
}
out <- c(out, "", if (length(missing)) c("Not found (the page looks for these names, any case):", missing)
  else "Not found: none (every column the page looks for is here).")

# The dates: read, not read (by their form), blank; the first and last year.
date_cols <- c(detected_at, col$closedDate, col$quarantine)
date_cols <- unique(date_cols[!is.na(date_cols)])
if (length(date_cols)) {
  wd <- max(21, nchar(vapply(date_cols, column_name, character(1))) + 2)
  out <- c(out, "", "Dates (the page reads YYYY-MM-DD, YYYY/M/D and M/D/YYYY; a time after them is ignored)")
  for (i in date_cols) {
    v <- grid[, i]
    d <- date_of(v)
    ok <- !is.na(d$date)
    bad <- v != "" & !ok
    years <- as.integer(substr(d$date[ok], 1, 4))
    forms <- table(d$form[ok])
    line <- paste0("  ", pad(column_name(i), wd), sprintf("%2d read, %d not read, %2d blank", sum(ok), sum(bad),
      sum(v == "")), if (any(ok)) paste0("; years ", min(years), " to ", max(years)) else "",
      if (length(forms)) paste0("; written ", paste(paste(names(forms), forms), collapse = ", ")) else "")
    out <- c(out, line)
    if (any(bad)) {
      s <- sort(table(shape_of(v[bad])), decreasing = TRUE)
      out <- c(out, paste0("  ", pad("", wd), "not read, written as: ",
        paste(paste0("\"", names(s), "\" ", s), collapse = ", ")))
    }
  }
}

# The animals (the inventory column): read as a whole number with or without thousands commas (rules.js inventoryOf).
reads_as_animals <- function(v) grepl("^[0-9]+$", v) | grepl("^[0-9]{1,3}(,[0-9]{3})+$", v)
if (!is.na(col$inventory)) {
  v <- grid[, col$inventory]
  ok <- reads_as_animals(v)
  out <- c(out, "", paste0("Animals (", column_name(col$inventory), "): ", sum(ok), " read, ", sum(v != "" & !ok),
    " not read, ", sum(v == ""), " blank"))
}

# The animals added up over every row, mapped or not, every kind of animal (2.8), to compare with the HPAI update's
# "birds affected" (cattle included: the update has had none so far): the
# inventory column and Depop Inventory (not read by the page), each cell read as the inventory is. A sum is a count,
# never a row's value as written.
depop_at <- column_index(header, "Depop Inventory")
sum_line <- function(i, name) {
  if (is.na(i)) return(paste0("  ", pad(name, 22), "not in the table"))
  v <- grid[, i]
  ok <- reads_as_animals(v)
  total <- sum(as.numeric(gsub(",", "", v[ok])))
  paste0("  ", pad(column_name(i), 22), formatC(total, format = "f", digits = 0, big.mark = ","), " (", sum(ok),
    " read, ", sum(v != "" & !ok), " not read, ", sum(v == ""), " blank)")
}
out <- c(out, "", "Animals added up over every row, every kind of animal, to compare with the HPAI update's \"birds affected\"",
  "(a cell not read is left out):", sum_line(col$inventory, "Flock/Herd Inventory"), sum_line(depop_at, "Depop Inventory"))

# The category columns: each value and its rows; how the page reads the status, closed and quarantine values.
status_of <- function(v) {
  l <- tolower(v)
  for (s in names(STATUSES)) if (l %in% STATUSES[[s]]) return(s)
  "no status"
}
# The page's word rule (types.js hasWord): the word at the start of a word of the text, both in lowercase.
has_word <- function(v, w) grepl(paste0("(^|[^a-z0-9])", gsub("([][{}()+*^$|\\\\?.])", "\\\\\\1", w)), v, perl = TRUE)
# Where a word starts a word of the text (rules.js: types.js wordStarts), as positions from 1.
word_starts <- function(v, w) {
  at <- gregexpr(gsub("([][{}()+*^$|\\\\?.])", "\\\\\\1", w), v, perl = TRUE)[[1]]
  at <- at[at > 0]
  if (!length(at)) return(at)
  at[at == 1 | !grepl("[a-z0-9]", substring(v, at - 1, at - 1))]
}
# A species' kinds, as the page reads it (rules.js kindOf): "Cattle", "Birds and Cattle", or "Other animals, not
# listed".
kind_of <- function(v) {
  s <- gsub("\\s+", " ", tolower(trimws(v)))
  if (s == "") return(names(KINDS)[1])
  covered <- function(k, w, at) {
    others <- unlist(KINDS[names(KINDS) != k])
    any(nchar(others) > nchar(w) & substring(s, at, at + nchar(others) - 1) == others)
  }
  named <- Filter(function(k) any(vapply(KINDS[[k]], function(w)
    any(!vapply(word_starts(s, w), function(at) covered(k, w, at), logical(1))), logical(1))), names(KINDS))
  if (length(named)) return(paste(named, collapse = " and "))
  paste0(names(KINDS)[length(KINDS)], ", not listed")
}
mark_of <- function(i, v) {
  if (!is.na(col$species) && i == col$species) return(kind_of(v))
  if (!is.na(col$status) && i == col$status) return(if (v == "") "no status" else status_of(v))
  if (!is.na(col$closed) && i == col$closed) return(if (tolower(v) %in% CLOSED_VALUES) "closed" else "")
  if (!is.na(col$quarantineStatus) && i == col$quarantineStatus) {
    l <- tolower(v)
    return(if (v == "") "" else if (l %in% QUARANTINE_UNDER) "under" else if (l %in% QUARANTINE_RELEASED) "released"
      else "not read")
  }
  ""
}
cat_cols <- sort(unique(c(col$status, col$closed, col$disease, col$flockType, shown_at, col$species,
  col$quarantineStatus)))
cat_cols <- cat_cols[!is.na(cat_cols)]
if (length(cat_cols) && n_rows) {
  wc <- max(19, nchar(vapply(cat_cols, column_name, character(1))) + 2)
  out <- c(out, "", paste("A category value found in fewer than", MIN_ROWS, "rows (other than a status, closed or quarantine"),
    "word), or holding a date, a coordinate, a county name or a Case ID, is shown by its shape in quotes:",
    "each letter an a, each digit a 9, never as written.",
    "Category values (value: rows; how the page reads it in brackets)")
  for (i in cat_cols) {
    v <- grid[, i]
    t <- table(v)
    t <- t[order(-as.integer(t), names(t))]
    if (length(t) > MAX_VALUES) {
      txt <- paste0(length(t), " different values: too many to be category words, so not listed")
    } else {
      # Each value as shown (as written, or its shape) with how the page reads it; values shown the same are added up.
      shown <- vapply(seq_along(t), function(k) {
        x <- names(t)[k]
        if (x == "") "(blank)" else if (nchar(x) > MAX_VALUE_CHARS) paste0("(a value of ", nchar(x), " characters)")
        else if (looks_private(x) || (as.integer(t[k]) < MIN_ROWS && !(tolower(x) %in% KNOWN_WORDS)))
          paste0("\"", shape_of(x), "\"")
        else gsub("[[:cntrl:]]", " ", x)
      }, character(1))
      marks <- vapply(names(t), function(x) mark_of(i, x), character(1))
      key <- paste0(shown, ": ", marks)
      first <- !duplicated(key)
      rows <- as.integer(tapply(as.integer(t), factor(key, levels = unique(key)), sum))
      txt <- paste(paste0(shown[first], ": ", rows, ifelse(nzchar(marks[first]), paste0(" (", marks[first], ")"), "")),
        collapse = ", ")
    }
    out <- c(out, paste0("  ", pad(column_name(i), wc), txt))
  }
}

# The County column: the forms it is written in, never the names.
if (!is.na(col$county)) {
  v <- grid[, col$county]
  key <- tolower(sub(" county$", "", gsub("\\s+", " ", v), ignore.case = TRUE))
  known <- v != "" & key %in% tolower(WA_COUNTIES)
  as_map <- known & v %in% WA_COUNTIES
  with_county <- known & !as_map & grepl(" county$", gsub("\\s+", " ", v), ignore.case = TRUE)
  other_case <- known & !as_map & !with_county
  out <- c(out, "", "County, how it is written (the forms, never the names):", paste0("  \"Name\" ", sum(as_map),
    ", \"name\" ", sum(other_case), ", \"Name County\" ", sum(with_county), ", not a Washington county ",
    sum(v != "" & !known), ", blank ", sum(v == "")))
}

# The coordinates: mapped or not, and why (rules.js notMappedReason).
lat_t <- col_cells(col$lat)
lon_t <- col_cells(col$lon)
lat <- number_of(lat_t)
lon <- number_of(lon_t)
mapped <- usable(lat, lon)
none <- !mapped & lat_t == "" & lon_t == ""
no_lat <- !mapped & !none & lat_t == ""
no_lon <- !mapped & !none & !no_lat & lon_t == ""
swapped <- !mapped & !none & !no_lat & !no_lon & !is.na(lat) & !is.na(lon) &
  lon >= WA[["south"]] & lon <= WA[["north"]] & lat >= WA[["west"]] & lat <= WA[["east"]]
unreadable <- !mapped & !none & !no_lat & !no_lon & !swapped
outside <- mapped & !(lat >= WA[["south"]] & lat <= WA[["north"]] & lon >= WA[["west"]] & lon <= WA[["east"]])
out <- c(out, if (is.na(col$county)) "" else character(0), paste0("Coordinates: mapped ", sum(mapped), " (outside the box around Washington ", sum(outside), "), not mapped ",
  sum(!mapped)), paste0("  not mapped because: no coordinates ", sum(none), ", no latitude ", sum(no_lat), ", no longitude ", sum(no_lon),
  ", not readable ", sum(unreadable), ", look swapped ", sum(swapped)))

# What the page would show on the last detection date, and on the day it opens on (rules.js windowOf, isPast,
# quarantineOf, groups, openingViews).
detected_text <- if (length(detected_at) && n_rows) apply(grid[, detected_at, drop = FALSE], 1, function(r) {
  f <- r[r != ""]
  if (length(f)) f[1] else ""
}) else rep("", n_rows)
detected <- date_of(detected_text)$date
closed_date <- date_of(col_cells(col$closedDate))$date
closed <- !is.na(col$closed) & tolower(col_cells(col$closed)) %in% CLOSED_VALUES
release <- date_of(col_cells(col$quarantine))$date
q_text <- tolower(col_cells(col$quarantineStatus))
q_status <- ifelse(q_text %in% QUARANTINE_UNDER, "under", ifelse(q_text %in% QUARANTINE_RELEASED, "released", NA))
dates <- detected[mapped & !is.na(detected)]
end <- if (length(dates)) max(dates) else NA_character_
# The groups on a day: closed when its closed date is on or before the day (with no day, any closed date); without
# one, when its closed column says so, from its release date (2.5; not a release date after the day the page is
# opened on, which cannot be when it closed), or with neither date on any day; a closed positive's quarantine on the
# day. Every mapped positive is counted, as the day is never before the last detection date (a positive without a
# readable date is shown whatever the day).
release_closes <- !is.na(release) & release <= on_day
day_not_known <- is.na(closed_date) & closed & !release_closes
groups_on <- function(day) {
  past <- ifelse(!is.na(closed_date), is.na(day) | closed_date <= day,
    ifelse(closed & release_closes, is.na(day) | release <= day, closed))
  quarantine <- rep(NA_character_, n_rows)
  if (!is.na(col$quarantine) || !is.na(col$quarantineStatus)) {
    quarantine <- ifelse(!past, NA_character_,
      ifelse(!is.na(release), ifelse(!is.na(day) & release > day, "under", "released"),
        ifelse(!is.na(q_status), q_status, if (!is.na(col$quarantineStatus)) "unknown" else "under")))
  }
  paste0("  active ", sum(mapped & !past), ", closed ", sum(mapped & past), " (still under quarantine ",
    sum(mapped & quarantine %in% "under"), ", not known ", sum(mapped & quarantine %in% "unknown"), "), not mapped ",
    sum(!mapped))
}
month_year <- function(d) paste(month.name[as.integer(substr(d, 6, 7))], substr(d, 1, 4))
on_end <- if (is.na(end)) "(no readable detection date, so no end date)" else paste0("(", month_year(end), ")")
out <- c(out, "", paste("What the page would show on the last detection date", paste0(on_end, ":")), groups_on(end),
  paste0("  of the mapped positives, without a readable detection date: ", sum(mapped & is.na(detected))))
# How far back "On a day" can show the outbreak as it stood: a positive closes on its closed date (whatever its closed
# column says), else, closed by that column, on its release date; with neither (or a release date after today), it
# shows closed on every day, so on a day before today it may show closed too early. The three add up to the positives
# closed by either column.
if (!is.na(col$closed)) {
  out <- c(out, paste0("  of the mapped closed positives: closed on their Close Date ", sum(mapped & !is.na(closed_date)),
    ", on their release date ", sum(mapped & closed & is.na(closed_date) & release_closes), ", on a day not known ",
    sum(mapped & day_not_known)))
}
# The page opens both views on today, or on the last detection date when that is later (a typing slip, or the
# computer's date set wrong), so no positive is hidden. Today is not from the table, so it is shown in full.
day_words <- paste0(month.name[as.integer(substr(on_day, 6, 7))], " ", as.integer(substr(on_day, 9, 10)), ", ",
  substr(on_day, 1, 4))
if (is.na(end)) {
  out <- c(out, "", "What the page opens on: no readable detection date, so no day to open on (the counts above).")
} else if (end > on_day) {
  out <- c(out, "", paste0("What the page opens on: a detection is after today (", day_words,
    "), so both views open on the last"), paste0("detection date (", month_year(end), "), the counts above."))
} else {
  out <- c(out, "", paste0("What the page opens on, today (", day_words, "), in both views:"), groups_on(on_day),
    "  (\"On a day\" opens on today, \"Between dates\" from the first detection to today: the same positives.)")
}

out <- c(out, "", paste0("Saved as ", basename(report_path), " beside CHECK_HPAI_TABLE.bat. Read it before sending it."))
cat(out, sep = "\n")
con <- file(report_path, "wb")
writeBin(charToRaw(enc2utf8(paste0(paste(out, collapse = "\r\n"), "\r\n"))), con)
close(con)
