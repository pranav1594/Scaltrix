import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/** Email of the signed-in user, used as "Prepared by" on PDFs. */
export function useUserEmail(): string | undefined {
  const [email, setEmail] = useState<string | undefined>();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? undefined));
  }, []);
  return email;
}
