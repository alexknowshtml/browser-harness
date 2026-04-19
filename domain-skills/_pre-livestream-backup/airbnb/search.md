# Airbnb - Search

## URL Pattern

  https://www.airbnb.com/s/{City}--{State}/homes
    ?checkin=YYYY-MM-DD
    &checkout=YYYY-MM-DD
    &adults=N
    &room_types[]=Entire+home/apt

City/state spaces become hyphens: 'New York City' -> 'New-York-City--New-York'

## Critical: domcontentloaded Only

DO NOT use networkidle -- it times out on Airbnb every time.
Use wait_for_load() which defaults to domcontentloaded.

## Extraction

After page loads, screenshot() to verify results, then:

  results = js("""
    const cards = document.querySelectorAll('[data-testid="card-container"]');
    return Array.from(cards).slice(0, 10).map(card => {
      const title = card.querySelector('[data-testid="listing-card-title"]');
      const price = card.querySelector('._tyxjp1');
      const rating = card.querySelector('[aria-label*="rating"]');
      const link = card.querySelector('a[href*="/rooms/"]');
      return {
        title: title ? title.innerText : '',
        price: price ? price.innerText : '',
        rating: rating ? rating.getAttribute('aria-label') : '',
        url: link ? 'https://www.airbnb.com' + link.getAttribute('href') : ''
      };
    });
  """)
  print(results)

Note: CSS classes (like _tyxjp1) change frequently. Prefer data-testid and aria-label attributes.

## Why Airbnb Over Alternatives

- Airbnb has 5-10x more entire-home inventory vs. Booking.com
- Hotels.com and Booking.com block headless scrapers
- Google Hotels sometimes resets to today's dates instead of target dates
- Airbnb returned accurate results for future dates consistently

## Booking Link Format

Include checkin/checkout/adults in shared URL so price is pre-filled:
  https://www.airbnb.com/rooms/{ID}?checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&adults=N

## Key Learnings (2026-04-18 session)

- For popular event weekends, 60-80% inventory disappears weeks in advance
- Price shown on card is nightly rate -- check total at listing page
- Sort by Total Price (not Recommended) for apples-to-apples comparison
- Entire home filter essential for 3+ person groups
- 645 entire homes available Indianapolis May 21-23 (compared to 72% sold out on Booking.com)
