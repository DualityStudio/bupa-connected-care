# Daily statistics

The kiosk creates one JSON file per local calendar date in this directory while it is running. The generated `.json` files are ignored by Git so that each Raspberry Pi keeps its own event data.

Copy the JSON files off the Pi after each event day. Old files are retained; a new, empty set of counters is created automatically when the next day's first event is recorded.
