"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import { publicEnv } from "@/lib/env";
import type { Freshness } from "../logic";

export type LivePoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  freshness: Freshness;
  age: string;
  help?: boolean;
};

const COLOR: Record<Freshness, string> = { live: "#1f7a4d", stale: "#b26b00", lost: "#8a8fa3" };

export default function LiveLeaflet({ points }: { points: LivePoint[] }) {
  const center: [number, number] = points[0] ? [points[0].lat, points[0].lon] : [17.385, 78.4867];
  return (
    <MapContainer center={center} zoom={14} scrollWheelZoom={false} className="h-full w-full">
      <TileLayer url={publicEnv.NEXT_PUBLIC_MAP_TILE_URL} attribution={publicEnv.NEXT_PUBLIC_MAP_ATTRIBUTION} />
      {points.map((p) => (
        <CircleMarker
          key={p.id}
          center={[p.lat, p.lon]}
          radius={p.help ? 12 : 8}
          pathOptions={{
            color: p.help ? "#e31e25" : "#ffffff",
            weight: p.help ? 4 : 2,
            fillColor: COLOR[p.freshness],
            fillOpacity: p.freshness === "live" ? 1 : 0.5,
            dashArray: p.freshness === "live" ? undefined : "4",
          }}
        >
          <Popup>
            <strong>{p.name}</strong>
            <div>
              {p.freshness === "live" ? "Updated" : "Last seen"} {p.age}
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
