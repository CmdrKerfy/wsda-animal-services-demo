#!/usr/bin/env Rscript
# S6 reference: unchanged CVI module and helpers, synthetic data only; no page implementation.
suppressPackageStartupMessages({library(jsonlite);library(shiny);library(bslib);library(shinyjs);library(cli);library(glue);library(DT);library(mapgl);library(sf)})
args <- commandArgs(FALSE); script <- sub('^--file=', '', args[grep('^--file=',args)])
repo <- normalizePath(file.path(dirname(script), '../..'))
out <- file.path(repo,'local-test-artifacts/s6/day1')
cvi <- Sys.getenv('CVI_TRACEABILITY_DIR',file.path(dirname(repo),'CVI_Traceability'))
sha <- function(p) paste(as.character(openssl::sha256(file(p))), collapse="")
inputs <- fromJSON(file.path(out,'inputs.json'),simplifyVector=FALSE)
stopifnot(isTRUE(inputs$synthetic))
for (n in names(inputs$files)) stopifnot(identical(sha(file.path(out,n)),inputs$files[[n]]))
stopifnot(identical(sha(file.path(repo,'site/geo/wa-counties.js')),inputs$geometrySha256))
sources <- c('R/master_loader.R','R/map_helpers.R','R/ui_helpers.R','R/tile_basemap.R','R/static_map_renderer.R','R/charts.R','modules/mod_maps.R')
source_hashes <- setNames(lapply(sources,function(f)sha(file.path(cvi,'shiny',f))),sources)
stopifnot(source_hashes[['R/map_helpers.R']]=='ceddb9ac9ca3a6b8eb4fe58ccdf173ea563207a80f87f178781aad36a234a66c',
 source_hashes[['modules/mod_maps.R']]=='a5bae40d60a8e01a2b3dea6399be6e03ef4cdfca7d82106886fbdfef6b486115')
suppressPackageStartupMessages(for (f in sources) source(file.path(cvi,'shiny',f),local=.GlobalEnv))
root <- file.path(out,'empty_cvi_root');dir.create(root,showWarnings=FALSE)
stopifnot(length(list.files(root,all.files=TRUE,no..=TRUE))==0)
paths <- character(); loading <- TRUE
pathfn <- function(kind) function(...) {
 pieces <- c(...)
 if (any(grepl('(^/|^[A-Za-z]:|(^|[/\\\\])\\.\\.([/\\\\]|$))',pieces))) stop('Unsafe data path')
 # During helper loading, only exact generated input names resolve to fixture files.
 p <- if(loading && kind=='reference' && length(pieces)==1 && pieces %in% names(inputs$files)) file.path(out,pieces) else file.path(root,kind,...)
 paths <<- union(paths,p);p
}
cvi_dir_reference <- pathfn('reference');cvi_dir_exports <- pathfn('exports');cvi_dir_www <- pathfn('www');cvi_dir_tile_cache <- pathfn('tile_cache')
reg <- .build_overlay_registry()
keys <- c('schema','explicit','precision','missing')
layers <- setNames(lapply(keys,function(k)load_overlay_csv(reg[[k]]$file,reg[[k]]$name_col)),keys)
replacement <- load_overlay_csv('replacement.csv','name')
loading <- FALSE
check_n <- 0L
check <- function(x,label) {if(!isTRUE(x))stop(label);check_n <<- check_n+1L}
check(all(vapply(layers,Negate(is.null),logical(1))), 'synthetic layers loaded')
schema <- layers$schema
schema_ref <- list(types=lapply(st_drop_geometry(schema),class),auto=I(cvi_overlay_filter_cols(schema,'name')),
 choices=setNames(lapply(cvi_overlay_filter_cols(schema,'name'),function(c)I(cvi_overlay_col_choices(schema,c))),cvi_overlay_filter_cols(schema,'name')))
factor_probe <- data.frame(Kind=factor(c('A','B')),numeric=c(1,2),logical=c(TRUE,FALSE))
schema_ref$factor_cols <- I(cvi_overlay_filter_cols(factor_probe))
geo <- fromJSON(file.path(out,'geometry.json'),simplifyVector=FALSE)
suppressMessages(sf_use_s2(FALSE))
geometry_refs <- lapply(geo$groups,function(g) {
 polys <- st_read(toJSON(g$counties,auto_unbox=TRUE,digits=NA),quiet=TRUE)
 pts <- st_as_sf(do.call(rbind,lapply(g$points,function(p)data.frame(name=p$name,lon=p$lon,lat=p$lat))),coords=c('lon','lat'),crs=4326)
 hits <- st_intersects(pts,polys)
 tagged <- cvi_assign_overlay_county(list(pts),polys)[[1]][['._county']]
 list(name=g$name,matches=lapply(hits,function(h)I(as.character(polys$name[h]))),first=I(tagged))
})
polys <- st_read(toJSON(geo$groups[[1]]$counties,auto_unbox=TRUE,digits=NA),quiet=TRUE)
precision <- st_drop_geometry(layers$precision)
precision_ref <- list(rows=precision, default_missing=I(layers$missing$geo_source),
 png=cvi_facility_county_counts(layers$precision,polys))
box <- new.env();sess <- MockShinySession$new();box$messages<-list()
unlockBinding('sendInputMessage',sess)
sess$sendInputMessage <- function(inputId,message) box$messages[[length(box$messages)+1L]]<-list(id=inputId,message=message)
lockBinding('sendInputMessage',sess)
# Independent row oracle: tokenize directly, independent of CVI's filtering helper.
independent <- function(layer,county,picks,selected,choices,polygons) {
 d<-layer
 hits<-st_intersects(st_geometry(d),st_geometry(polygons))
 tags<-vapply(hits,function(h)if(length(h))as.character(polygons$name[h[1]])else NA_character_,character(1))
 keep<-if(length(county)) !is.na(tags)&tags%in%county else rep(TRUE,nrow(d))
 if(selected)for(col in names(picks))if(col%in%names(choices)&&length(picks[[col]])) {
  values<-trimws(as.character(d[[col]]));multi<-any(grepl('[|;]',values),na.rm=TRUE)
  hit<-if(multi)vapply(values,function(v)if(is.na(v))FALSE else any(trimws(strsplit(v,'[|;]')[[1]])%in%picks[[col]]),logical(1))else values%in%picks[[col]]
  keep<-keep&hit
 }
 as.character(d$RowID[keep])
}
testServer(mod_maps_server,args=list(rv=reactiveValues(master_df=NULL),project_root=root,scripts_dir=root),session=sess,{
 session$flushReact() # Settle startup's empty-root overlay loader before injection.
 assign('.OVERLAY_REGISTRY',reg,envir=.GlobalEnv)
 map_state$county_polygons <- st_sf(name=polys$name,geometry=st_geometry(polys))
 # An unselected built-in sentinel satisfies CVI's once-loaded guard; otherwise
 # its observer reloads custom-only sets from the deliberately empty root.
 map_state$overlays <- c(layers,list(slaughterhouses=layers$schema));session$flushReact()
 session$setInputs(show_facilities=1,overlay_layers=keys,fac_county=character(0),facilities_show_cvi=FALSE,
 facilities_show_labels=FALSE,facilities_show_outlines=TRUE,facilities_basemap='https://basemaps.cartocdn.com/gl/positron-gl-style/style.json')
 session$elapse(300)
 check(identical(active_map(),'facilities'),'full Facilities module route active')
 choices<-map_state$facility_filter_choices
 check(identical(names(choices$schema),as.character(schema_ref$auto)),'module auto choices equal helper')
 check(identical(names(choices$explicit),c('numeric','thirtyone','Species201')),'whitelist numeric/high-cardinality accepted and screened')
 box$choices<-choices;box$cases<-list()
 snapshot <- function(name,county=character(),picks=list(),selected=keys) {
  # Clear every cached input so scenes are independent.
  for(li in seq_along(choices))for(ci in seq_along(choices[[li]]))do.call(session$setInputs,setNames(list(character()),.facfilt_id(li,ci)))
  session$setInputs(overlay_layers=selected,fac_county=county)
  for(k in names(picks))for(col in names(picks[[k]])) {
   li<-match(k,names(choices));ci<-match(col,names(choices[[k]]))
   do.call(session$setInputs,setNames(list(picks[[k]][[col]]),.facfilt_id(li,ci)))
  }
  session$elapse(300)
  filtered<-filtered_facility_overlays()[keys]
  ids<-lapply(filtered,function(d)I(as.character(d$RowID)))
  expected<-setNames(lapply(keys,function(k)I(independent(layers[[k]],county,picks[[k]],k%in%selected,choices[[k]],polys))),keys)
  check(identical(ids,expected),paste('module row oracle',name))
  widget<-tryCatch(fromJSON(output$facilities_map,simplifyVector=FALSE),error=function(e)list(error=conditionMessage(e)))
  box$cases[[name]]<-list(county=I(county),selected=I(selected),picks=picks,ids=ids,counts=lapply(filtered,nrow),
   boxes=output$value_boxes,strip=output$filter_summary_strip,widget=widget)
 }
 snapshot('all')
 snapshot('county',county='Pierce')
 snapshot('county_zero',county='King')
 snapshot('tokens_or',picks=list(schema=list(Operation.Type=c('Caprine','Equine'))))
 snapshot('tokens_and',picks=list(schema=list(Operation.Type='Caprine',two='Alpha')))
 snapshot('literal_comma',picks=list(schema=list(Operation.Type='Bovine, Other')))
 snapshot('literal_slash',picks=list(schema=list(Operation.Type='Vet/Clinic')))
 snapshot('explicit_numeric',picks=list(explicit=list(numeric='1',Species201=c('s1','s4'))))
 snapshot('stale_pick',picks=list(schema=list(two='not present')))
 snapshot('disabled_pick',picks=list(schema=list(two='Alpha')),selected=setdiff(keys,'schema'))
 snapshot('reenabled_pick',picks=list(schema=list(two='Alpha')))
 snapshot('no_layers',selected=character())
 snapshot('all_again')
 before<-choices$schema$two
 changed<-c(layers,list(slaughterhouses=layers$schema));changed$schema<-replacement;changed$explicit<-replacement
 map_state$overlays<-changed;session$flushReact()
 box$replacement<-list(before=I(before),after=I(map_state$facility_filter_choices$schema$two),
  unchanged_signature=identical(map_state$facility_filter_choices$schema$two,before),
  raw_values=I(unique(as.character(map_state$overlays$schema$two))))
 check(isTRUE(box$replacement$unchanged_signature),'source same-size cache finding reproduced')
 box$messages<-list();session$setInputs(reset_filters=1);session$flushReact()
 box$reset<-box$messages
 check(!any(vapply(box$reset,function(m)identical(m$id,'fac_county')||grepl('^facfilt_',m$id),logical(1))),'source reset omits county and dynamic picks')
 if ('--activity' %in% commandArgs(TRUE)) {
  activity <- list(); hashes <- list()
  for (tier in c('full','partner','public')) {
   file <- file.path(repo,'local-test-artifacts/f1/tiers',tier,if(tier=='partner')'partner_county_totals.csv' else 'CVI_Consolidated_Master.csv')
   df <- load_master_csv(file); stopifnot(!is.null(df));hashes[[tier]]<-sha(file)
   map_state$master_df <- df;session$flushReact()
   spp <- sort(unique(df$Species.Group));years<-sort(unique(df$Reporting.Year))
   session$setInputs(show_facilities=2,facilities_show_cvi=TRUE,facilities_species=spp,facilities_year=years,facilities_quarter=c('Q1','Q2','Q3','Q4'),facilities_species_sub=character(),facilities_opacity=.6,county_palette='WSDA Default',fac_county=character(),overlay_layers=keys)
   capture_activity <- function(name,widget=FALSE) {
    session$elapse(300);d<-facilities_circle_data()
    activity[[paste(tier,name,sep='/')]] <<- list(tier=tier,species=I(input$facilities_species),years=I(as.integer(input$facilities_year)),quarters=I(input$facilities_quarter),raw=I(input$facilities_species_sub),scaling=input$facilities_scaling,nBins=input$facilities_n_bins,palette=input$county_palette,data=d,
     widget=if(widget)fromJSON(output$facilities_map,simplifyVector=FALSE)else NULL)
   }
   for (sc in c('log','linear','sqrt','quantile','natural')) for (bins in 3:10) {
    session$setInputs(facilities_scaling=sc,facilities_n_bins=bins)
    capture_activity(paste(sc,bins,sep='/'),tier=='full')
   }
   if(tier=='full') {
    session$setInputs(facilities_scaling='log',facilities_n_bins=5)
    for(palette in names(DIRECTION_PALETTES)){session$setInputs(county_palette=palette);capture_activity(paste0('palette/',palette),TRUE)}
    session$setInputs(county_palette='WSDA Default',facilities_species='Cattle');capture_activity('cattle',TRUE)
    if('Species'%in%names(df)){session$setInputs(facilities_species_sub=unique(df$Species[df$Species.Group=='Cattle'])[1]);capture_activity('raw',TRUE)}
    session$setInputs(facilities_species=spp,facilities_species_sub=character(),facilities_year=years[1],facilities_quarter='Q1');capture_activity('period',TRUE)
    session$setInputs(facilities_year=years,facilities_quarter=c('Q1','Q2','Q3','Q4'));capture_activity('unfiltered',TRUE)
    session$setInputs(fac_county='King');capture_activity('facility_county',TRUE)
    session$setInputs(facfilt_001_001='Alpha');capture_activity('facility_refine',TRUE)
   }
  }
  activity_out<-file.path(repo,'local-test-artifacts/s6/day5');dir.create(activity_out,recursive=TRUE,showWarnings=FALSE)
  write_json(list(meta=list(synthetic=TRUE,oracle_sha256=sha(script),sources=source_hashes,tiers=hashes,route='unchanged Facilities module reactive and rendered widget through testServer'),cases=activity),file.path(activity_out,'activity_reference.json'),auto_unbox=TRUE,null='null',na='null',digits=I(17))
  cat('S6 activity R: PASS;',length(activity),'full-module activity cases\n')
 }
})
check(length(list.files(root,all.files=TRUE,no..=TRUE))==0,'module root remains empty')
module_paths<-paths[startsWith(paths,root)]
check(all(startsWith(paths,root)|paths%in%file.path(out,names(inputs$files))),'only isolated paths and exact fixture files accessed')
ref<-list(meta=list(synthetic=TRUE,source_hashes=source_hashes,oracle_sha256=sha(script),inputs_sha256=sha(file.path(out,'inputs.json')),
 geometry_sha256=inputs$geometrySha256,r=R.version.string,collation=Sys.getlocale('LC_COLLATE'),sf=as.character(packageVersion('sf')),
 route='unchanged full mod_maps_server through shiny::testServer; empty data root, loaded synthetic sf injected',
 paths=I(paths),module_paths=I(module_paths),empty_root=TRUE),schema=schema_ref,geometry=geometry_refs,precision=precision_ref,
 choices=box$choices,cases=box$cases,replacement=box$replacement,reset=box$reset,checks=check_n)
write_json(ref,file.path(out,'reference.json'),auto_unbox=TRUE,null='null',na='null',digits=I(17),pretty=FALSE)
cat('S6 R: PASS;',check_n,'checks;',length(box$cases),'full-module cases;',sum(vapply(geometry_refs,function(g)length(g$matches),integer(1))),'geometry probes\n')
