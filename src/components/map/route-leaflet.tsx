"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { MapContainer, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { publicEnv } from "@/lib/env";

export type RouteLine = {
  id: string;
  name: string;
  href?: string;
  coordinates: [number, number][];
  highlight?: boolean;
};

const HYDERABAD: [number, number] = [17.385, 78.4867];

function FitBounds({ lines }: { lines: RouteLine[] }) {
  const map = useMap();
  useEffect(() => {
    const points = lines.flatMap((l) => l.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]));
    if (points.length > 1) map.fitBounds(points, { padding: [24, 24], maxZoom: 17 });
  }, [lines, map]);
  return null;
}

export default function RouteLeaflet({ lines }: { lines: RouteLine[] }) {
  return (
    <MapContainer center={HYDERABAD} zoom={11} scrollWheelZoom={false} className="h-full w-full">
      <TileLayer url={publicEnv.NEXT_PUBLIC_MAP_TILE_URL} attribution={publicEnv.NEXT_PUBLIC_MAP_ATTRIBUTION} />
      {lines.map((l) => (
        <Polyline
          key={l.id}
          positions={l.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])}
          pathOptions={{ color: l.highlight === false ? "#94a3b8" : "#16a34a", weight: 5, opacity: 0.9 }}
        >
          <Popup>{l.href ? <a href={l.href}>{l.name}</a> : <strong>{l.name}</strong>}</Popup>
        </Polyline>
      ))}
      <FitBounds lines={lines} />
    </MapContainer>
  );
}
