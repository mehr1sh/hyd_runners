import { useState } from "react";
import { Text, TextInput } from "react-native";
import { supabase } from "../auth/supabase";
import { Button, Card, Screen, styles } from "./kit";

/** Email + password sign-in with the runner's HYD Runners account. */
export function SignInScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (e) setError(e.message === "Invalid login credentials" ? "Email or password is incorrect." : e.message);
  }

  return (
    <Screen title="Sign in">
      <Text style={styles.p}>Use your HYD Runners account. Recorded runs sync to it automatically.</Text>
      <Card>
        <TextInput
          style={styles.input}
          placeholder="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          value={email}
          onChangeText={setEmail}
          accessibilityLabel="Email"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          value={password}
          onChangeText={setPassword}
          accessibilityLabel="Password"
          onSubmitEditing={submit}
        />
        {error ? (
          <Text accessibilityRole="alert" style={[styles.muted, { color: "#c5221f" }]}>
            {error}
          </Text>
        ) : null}
        <Button label={busy ? "Signing in…" : "Sign in"} onPress={submit} disabled={busy || !email || !password} />
      </Card>
      <Text style={styles.muted}>New to HYD Runners? Create an account on the website first.</Text>
    </Screen>
  );
}
