"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Layout shell for logging a workout. Saving is implemented by the Training feature. */
export function LogWorkoutDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden /> Log a workout
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log a workout</DialogTitle>
          <DialogDescription>
            Saving workouts is not available yet. This form shows the planned fields.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="duration">Duration (minutes)</FieldLabel>
              <Input id="duration" name="duration" type="number" inputMode="numeric" min={1} />
            </Field>
            <Field>
              <FieldLabel htmlFor="distance">Distance (km, optional)</FieldLabel>
              <Input id="distance" name="distance" type="number" inputMode="decimal" min={0} step="0.1" />
            </Field>
            <Field>
              <FieldLabel htmlFor="notes">How did it feel?</FieldLabel>
              <Textarea id="notes" name="notes" rows={3} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled>
              Save workout
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
