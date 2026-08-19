# World Disasters

Live site: [https://pfaustino.github.io/earthquakes/](https://pfaustino.github.io/earthquakes/)

A globe of worldwide earthquakes, tornadoes, hurricanes/typhoons, and wildfires. **Live week** plays recent USGS, NWS/NHC/JMA, and EONET/NIFC feeds. **History 1900+** plays NOAA significant quakes plus bundled storm and fire catalogs. The default camera faces the Pacific; **Pacific view** resets to that pose.

```bash
npm install
npm run dev
```

`npm run fetch-noaa` refreshes the bundled NOAA snapshot.
`npm run fetch-weather` refreshes SPC EF2+ tornadoes, HURDAT2/IBTrACS cyclones, and NIFC/EONET wildfires.
`npm run fetch-fires` refreshes only the wildfire snapshot.
