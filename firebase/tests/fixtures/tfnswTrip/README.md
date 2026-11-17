`trip.json` follows the shape of a Transport for NSW Trip Planner API `/v1/tp/trip` response with
`outputFormat=rapidJSON` (journeys[].legs[].origin/destination with `departureTimePlanned` /
`departureTimeEstimated`, `transportation.disassembledName`, `stopSequence[].coord` as
[lat, lng], `isRealtimeControlled`) as documented on opendata.transport.nsw.gov.au. The services,
times and coordinates are made up for the test -- not a recorded response (there's no TfNSW key
in this environment).
