import Link from "next/link";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/features/identity/actions";
import type { CurrentUser } from "@/lib/auth/current-user";

export function UserMenu({ user }: { user: CurrentUser | null }) {
  if (!user) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href="/sign-in">Sign in</Link>
      </Button>
    );
  }

  const initials = user.displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Account menu for ${user.displayName}`}
          className="rounded-full"
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-brand-navy text-sm font-semibold text-white">
            {initials || "R"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{user.displayName}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">Profile and preferences</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/notifications">Notifications</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOut}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut aria-hidden />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
