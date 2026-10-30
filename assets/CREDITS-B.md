# Credits: terrain imagery and city data (agent B)

## Satellite imagery (assets/sat/*.jpg, assets/sat/landuse.json)

- **Source:** EOX Sentinel-2 cloudless, **2016** layer only (WMTS layer `s2cloudless_3857`, "Sentinel-2 cloudless layer for 2016 by EOX").
  - WMTS: https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml
  - Tiles: `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg` (zoom 14)
  - Project page: https://s2maps.eu
- **License:** Creative Commons Attribution 4.0 International (CC BY 4.0): https://creativecommons.org/licenses/by/4.0/
- **Required attribution text (show it in the game's credits/about screen):**
  > Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)
- **Changes we made:** the tiles were mosaicked, reprojected from Web Mercator to a lat/lon grid, resampled to 2048² or 4096² and re-encoded as JPEG (`tools/build_sat.py`). `landuse.json` is a coarse water/vegetation classification derived from the same mosaics. In the game the imagery is colour-adjusted and blended with the procedural terrain. For Dubai, Tokyo, Rio de Janeiro, Hong Kong and Chicago it is also rotated and shifted to fit the game's fictional coastline.
- The later EOX layers (2017 to 2025) are CC BY-NC-SA 4.0 and are **not** used.

The JS attribution string is in `RJ.sat.attribution` and in `assets/sat/index.json` (`attribution`).

## OpenStreetMap building footprints

Not used. Overpass API (overpass-api.de, overpass.kumi.systems and overpass.private.coffee) could not be reached from the build machine, so no OSM data is shipped. If footprints are added later, they are ODbL 1.0 (https://opendatacommons.org/licenses/odbl/) and need the attribution "© OpenStreetMap contributors" (https://www.openstreetmap.org/copyright).
