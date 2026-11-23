import SwiftUI
import WidgetKit

// TrackLine's home-screen widget: drive time to Home and Work with live traffic, and the next
// planned drive with its leave time. The app writes the snapshot (services/homeWidget.ts, via
// modules/liveActivity setWidgetSnapshot) into the shared App Group; this only shows it, with the
// time it was worked out ("as of 8:12 am"), never a made-up figure. Tapping a row opens the route.

struct HomeWidgetPlace: Decodable {
    let label: String
    let minutes: Int?
    let slower: Bool?
    let url: String
}

struct HomeWidgetDrive: Decodable {
    let to: String
    let leaveAtText: String
    let url: String
}

struct HomeWidgetSnapshot: Decodable {
    let places: [HomeWidgetPlace]
    let nextDrive: HomeWidgetDrive?
    let updatedText: String
}

struct HomeWidgetEntry: TimelineEntry {
    let date: Date
    let snapshot: HomeWidgetSnapshot?
}

struct HomeWidgetProvider: TimelineProvider {
    func read() -> HomeWidgetSnapshot? {
        guard let json = UserDefaults(suiteName: "group.com.trackline.navigate")?.string(forKey: "homeWidget"),
              let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(HomeWidgetSnapshot.self, from: data)
    }
    func placeholder(in context: Context) -> HomeWidgetEntry { HomeWidgetEntry(date: Date(), snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (HomeWidgetEntry) -> Void) {
        completion(HomeWidgetEntry(date: Date(), snapshot: read()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<HomeWidgetEntry>) -> Void) {
        // The app refreshes the data; the widget just re-reads it every 15 minutes.
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
        completion(Timeline(entries: [HomeWidgetEntry(date: Date(), snapshot: read())], policy: .after(next)))
    }
}

struct TrackLineHomeWidgetView: View {
    let entry: HomeWidgetEntry
    var body: some View {
        if let s = entry.snapshot, !(s.places.isEmpty && s.nextDrive == nil) {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(s.places.prefix(2).enumerated()), id: \.offset) { _, p in
                    Link(destination: URL(string: p.url)!) {
                        HStack {
                            Text(p.label).font(.headline)
                            Spacer()
                            Text(p.minutes.map { "\($0) min" } ?? "—")
                                .font(.headline.bold())
                                .foregroundStyle(p.slower == true ? Color.orange : Color.primary)
                        }
                    }
                }
                if let d = s.nextDrive {
                    Link(destination: URL(string: d.url)!) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Next: \(d.to)").font(.caption).lineLimit(1)
                            Text("Leave \(d.leaveAtText)").font(.caption.bold())
                        }
                    }
                }
                Spacer(minLength: 0)
                Text("as of \(s.updatedText)").font(.caption2).foregroundStyle(.secondary)
            }
            .padding(2)
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text("TrackLine").font(.headline)
                Text("Save Home or Work in TrackLine to see drive times here.").font(.caption).foregroundStyle(.secondary)
            }
            .widgetURL(URL(string: "trackline://travel"))
        }
    }
}

struct TrackLineHomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TrackLineHomeWidget", provider: HomeWidgetProvider()) { entry in
            if #available(iOS 17.0, *) {
                TrackLineHomeWidgetView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
            } else {
                TrackLineHomeWidgetView(entry: entry).padding()
            }
        }
        .configurationDisplayName("Drive times")
        .description("Live drive time to Home and Work, and your next planned drive.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
