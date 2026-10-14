"use client";

import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import { publicEnv } from "@/lib/env";

export type ExplorerLocation = {
  id: string;
  name: string;
  kind: string;
  latitude: number;
  longitude: number;
  verified: boolean;
  upcomingEvents: number;
};

/** Hyderabad city centre (approx.). */
export const HYDERABAD: [number, number] = [17.385, 78.4867];

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(target ?? HYDERABAD, target ? 14 : 11, { duration: 0.6 });
  }, [map, target]);
  return null;
}

export default function MapExplorer({
  locations,
  selectedId,
}: {
  locations: ExplorerLocation[];
  selectedId: string | null;
}) {
  const selected = locations.find((l) => l.id === selectedId) ?? null;
  return (
    <MapContainer center={HYDERABAD} zoom={11} scrollWheelZoom={false} className="h-full w-full">
      <TileLayer url={publicEnv.NEXT_PUBLIC_MAP_TILE_URL} attribution={publicEnv.NEXT_PUBLIC_MAP_ATTRIBUTION} />
      <FlyTo target={selected ? [selected.latitude, selected.longitude] : null} />
      {locations.map((l) => (
        <CircleMarker
          key={l.id}
          center={[l.latitude, l.longitude]}
          radius={l.id === selectedId ? 12 : 9}
          pathOptions={{
            color: "#ffffff",
            weight: 2,
            fillColor: l.upcomingEvents ? "#e31e25" : "#2c335a",
            fillOpacity: 1,
          }}
        >
          <Popup>
            <strong>{l.name}</strong>
            {!l.verified && <div>Unverified location</div>}
            <div>
              {l.upcomingEvents} upcoming event{l.upcomingEvents === 1 ? "" : "s"}
            </div>
            {l.upcomingEvents > 0 && <Link href={`/events?location=${l.id}`}>See events</Link>}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
