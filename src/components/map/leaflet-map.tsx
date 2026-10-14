"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import { publicEnv } from "@/lib/env";

export type MapPoint = { id: string; name: string; latitude: number; longitude: number; note?: string };

/** Hyderabad city centre (approx.), used when there are no points. */
const HYDERABAD: [number, number] = [17.385, 78.4867];

export default function LeafletMap({ points }: { points: MapPoint[] }) {
  const center: [number, number] = points[0] ? [points[0].latitude, points[0].longitude] : HYDERABAD;
  return (
    <MapContainer center={center} zoom={11} scrollWheelZoom={false} className="h-full w-full">
      <TileLayer url={publicEnv.NEXT_PUBLIC_MAP_TILE_URL} attribution={publicEnv.NEXT_PUBLIC_MAP_ATTRIBUTION} />
      {points.map((p) => (
        <CircleMarker
          key={p.id}
          center={[p.latitude, p.longitude]}
          radius={9}
          pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#e31e25", fillOpacity: 1 }}
        >
          <Popup>
            <strong>{p.name}</strong>
            {p.note && <div>{p.note}</div>}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
