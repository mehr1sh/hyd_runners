"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createClubAction,
  createInviteAction,
  decideRequestAction,
  joinClubAction,
  joinWithInviteAction,
  leaveClubAction,
  postClubAnnouncementAction,
  removeMemberAction,
  revokeInviteAction,
  setMemberRoleAction,
  updateClubAction,
  type ClubFormState,
} from "../actions";
import { CLUB_ROLE_LABEL, JOIN_POLICY_LABEL, type ClubRole, type JoinPolicy } from "../logic";

const idle: ClubFormState = { status: "idle" };
const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-brand-navy outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function Note({ state }: { state: ClubFormState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={`text-xs ${state.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
    >
      {state.message}
    </p>
  );
}

export function ClubForm({
  club,
  locations,
}: {
  club?: {
    id: string;
    name: string;
    slug: string;
    description: string;
    area: string | null;
    homeLocationId: string | null;
    joinPolicy: JoinPolicy;
  };
  locations: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(club ? updateClubAction : createClubAction, idle);
  const p = club?.id ?? "new-club";
  return (
    <form action={action} className="space-y-3 rounded-xl border bg-card p-4">
      {club && <input type="hidden" name="clubId" value={club.id} />}
      {club && <input type="hidden" name="slug" value={club.slug} />}
      <label className="grid gap-1 text-sm" htmlFor={`${p}-name`}>
        Club name
        <Input id={`${p}-name`} name="name" required maxLength={80} defaultValue={club?.name} />
      </label>
      {!club && (
        <label className="grid gap-1 text-sm" htmlFor={`${p}-slug`}>
          Web address (optional, made from the name)
          <Input id={`${p}-slug`} name="slug" maxLength={60} placeholder="kbr-dawn-runners" />
        </label>
      )}
      <label className="grid gap-1 text-sm" htmlFor={`${p}-area`}>
        Area (optional)
        <Input
          id={`${p}-area`}
          name="area"
          maxLength={80}
          placeholder="Jubilee Hills"
          defaultValue={club?.area ?? ""}
        />
      </label>
      <label className="grid gap-1 text-sm" htmlFor={`${p}-home`}>
        Home ground (optional)
        <select
          id={`${p}-home`}
          name="homeLocationId"
          defaultValue={club?.homeLocationId ?? ""}
          className={selectClass}
        >
          <option value="">None</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm" htmlFor={`${p}-policy`}>
        Who can join
        <select
          id={`${p}-policy`}
          name="joinPolicy"
          defaultValue={club?.joinPolicy ?? "request"}
          className={selectClass}
        >
          {Object.entries(JOIN_POLICY_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm" htmlFor={`${p}-description`}>
        About the club
        <Textarea id={`${p}-description`} name="description" maxLength={2000} defaultValue={club?.description} />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : club ? "Save club" : "Create club"}
      </Button>
      <Note state={state} />
    </form>
  );
}

export function MembershipButton({
  clubId,
  joinPolicy,
  membership,
}: {
  clubId: string;
  joinPolicy: JoinPolicy;
  membership: { role: ClubRole; status: "pending" | "active" } | null;
}) {
  const [joinState, join, joining] = useActionState(joinClubAction, idle);
  const [leaveState, leave, leaving] = useActionState(leaveClubAction, idle);
  if (membership) {
    return (
      <form action={leave} className="space-y-1">
        <input type="hidden" name="clubId" value={clubId} />
        <Button type="submit" variant="outline" size="sm" disabled={leaving}>
          {leaving ? "Saving…" : membership.status === "pending" ? "Withdraw request" : "Leave club"}
        </Button>
        <Note state={leaveState} />
      </form>
    );
  }
  if (joinPolicy === "invite") {
    return <p className="text-sm text-muted-foreground">This club is invite only. Ask a member for an invite link.</p>;
  }
  return (
    <form action={join} className="space-y-1">
      <input type="hidden" name="clubId" value={clubId} />
      <Button type="submit" size="sm" disabled={joining}>
        {joining ? "Saving…" : joinPolicy === "open" ? "Join club" : "Ask to join"}
      </Button>
      <Note state={joinState} />
    </form>
  );
}

export function RequestDecision({ clubId, userId, name }: { clubId: string; userId: string; name: string }) {
  const [state, action, pending] = useActionState(decideRequestAction, idle);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" aria-label={`Request from ${name}`}>
      <input type="hidden" name="clubId" value={clubId} />
      <input type="hidden" name="userId" value={userId} />
      <Button type="submit" name="decision" value="approve" size="sm" disabled={pending}>
        Approve
      </Button>
      <Button type="submit" name="decision" value="decline" size="sm" variant="outline" disabled={pending}>
        Decline
      </Button>
      <Note state={state} />
    </form>
  );
}

export function MemberControls({
  clubId,
  userId,
  name,
  role,
  canAdmin,
}: {
  clubId: string;
  userId: string;
  name: string;
  role: ClubRole;
  canAdmin: boolean;
}) {
  const [roleState, setRole, settingRole] = useActionState(setMemberRoleAction, idle);
  const [removeState, remove, removing] = useActionState(removeMemberAction, idle);
  return (
    <div className="flex flex-wrap items-end gap-2">
      {canAdmin && (
        <form action={setRole} className="flex items-end gap-2" aria-label={`Role for ${name}`}>
          <input type="hidden" name="clubId" value={clubId} />
          <input type="hidden" name="userId" value={userId} />
          <label className="grid gap-1 text-xs text-muted-foreground">
            Role
            <select name="role" defaultValue={role} className={selectClass}>
              {Object.entries(CLUB_ROLE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={settingRole}>
            Set
          </Button>
          <Note state={roleState} />
        </form>
      )}
      <form action={remove}>
        <input type="hidden" name="clubId" value={clubId} />
        <input type="hidden" name="userId" value={userId} />
        <Button type="submit" size="sm" variant="ghost" disabled={removing} aria-label={`Remove ${name}`}>
          Remove
        </Button>
        <Note state={removeState} />
      </form>
    </div>
  );
}

export function InviteCreator({ clubId }: { clubId: string }) {
  const [state, action, pending] = useActionState(createInviteAction, idle);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
      <input type="hidden" name="clubId" value={clubId} />
      <label className="grid gap-1 text-sm">
        Valid for (days)
        <Input name="days" type="number" min={1} max={90} defaultValue={14} className="h-9 w-24" />
      </label>
      <label className="grid gap-1 text-sm">
        Uses
        <Input name="maxUses" type="number" min={1} max={1000} defaultValue={50} className="h-9 w-24" />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create invite link"}
      </Button>
      <Note state={state} />
    </form>
  );
}

export function InviteRow({
  clubId,
  inviteId,
  url,
  label,
}: {
  clubId: string;
  inviteId: string;
  url: string;
  label: string;
}) {
  const [state, action, pending] = useActionState(revokeInviteAction, idle);
  const [copied, setCopied] = useState(false);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
      <span className="min-w-0 font-mono text-xs break-all">{url}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <form action={action}>
          <input type="hidden" name="clubId" value={clubId} />
          <input type="hidden" name="inviteId" value={inviteId} />
          <Button type="submit" size="sm" variant="ghost" disabled={pending}>
            Revoke
          </Button>
        </form>
      </span>
      <Note state={state} />
    </li>
  );
}

export function ClubAnnouncementForm({ clubId }: { clubId: string }) {
  const [state, action, pending] = useActionState(postClubAnnouncementAction, idle);
  return (
    <form action={action} className="space-y-2 rounded-xl border bg-card p-3">
      <input type="hidden" name="clubId" value={clubId} />
      <label className="grid gap-1 text-sm" htmlFor={`club-ann-title-${clubId}`}>
        Announcement title
        <Input id={`club-ann-title-${clubId}`} name="title" required maxLength={120} />
      </label>
      <label className="grid gap-1 text-sm" htmlFor={`club-ann-body-${clubId}`}>
        Message to members
        <Textarea id={`club-ann-body-${clubId}`} name="body" required maxLength={5000} />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Posting…" : "Post to members"}
      </Button>
      <Note state={state} />
    </form>
  );
}

export function JoinWithInvite({ code }: { code: string }) {
  const [state, action, pending] = useActionState(joinWithInviteAction, idle);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="code" value={code} />
      <Button type="submit" disabled={pending}>
        {pending ? "Joining…" : "Join the club"}
      </Button>
      <Note state={state} />
    </form>
  );
}
