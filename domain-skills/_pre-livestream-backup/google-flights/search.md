# Google Flights - Search

## URL Pattern

Round-trip search with tfs= encoding:

  https://www.google.com/travel/flights/search?tfs=CBwQAhoe[encoded]&hl=en&curr=USD

The tfs= param is a base64-encoded protobuf. Build URLs by navigating Google Flights manually and copying the URL -- do not try to encode from scratch.

## Load Strategy

  goto('https://www.google.com/travel/flights/search?tfs=...&hl=en')
  wait_for_load()
  screenshot()  # verify results loaded before extracting

domcontentloaded + short wait works better than networkidle -- the page loads progressively.

## Extraction

After screenshot confirms results:

  results = js("""
    const items = document.querySelectorAll('li[data-ved]');
    return Array.from(items).slice(0, 8).map(el => el.innerText).join('---');
  """)
  print(results)

## What Each Result Contains

- Airline + flight number
- Departure time -> Arrival time (with timezone)
- Duration + number of stops
- Price (per person, round-trip unless labeled otherwise)

## Key Learnings (2026-04-18 session)

- Prices are per-person -- multiply by group size
- Saturday returns cheaper than Sunday -- post-event Sunday surge is real
- Nonstop premium ~-200 -- usually worth it for short trips
- Spirit/Frontier bag fees (-65/bag each way) often close the price gap vs. majors
- Results render progressively -- wait for the full list before extracting (screenshot to verify)
- Outbound + return searched separately to find best mix (not forced round-trip)
