import type { SupabaseClient } from '@supabase/supabase-js'
import type { GlobalRole } from '../src/roles.ts'

export type UserSpec = {
  email: string
  password: string
  fullName: string
  roles: GlobalRole[]
  mustChangePassword: boolean
}

/**
 * Brings one user in line with the spec and returns their id. Safe to run any
 * number of times.
 *
 * The password and the must-change-password flag belong to the user once they
 * first sign in, so they are set only while the user has never signed in.
 * Missing roles are added, and roles granted elsewhere are kept.
 */
export async function ensureUser(admin: SupabaseClient, spec: UserSpec): Promise<string> {
  const user = (await findUser(admin, spec.email)) ?? (await createUser(admin, spec))

  if (!user.last_sign_in_at) {
    // The database refuses a password change that it was not told to expect.
    const { error: grantError } = await admin.rpc('allow_password_change', { user_id: user.id })
    if (grantError) throw grantError
    const { error: passwordError } = await admin.auth.admin.updateUserById(user.id, { password: spec.password })
    if (passwordError) throw passwordError
    // Setting a password clears the flag, so the flag is written after it.
    const { error: flagError } = await admin
      .from('profiles')
      .update({ must_change_password: spec.mustChangePassword })
      .eq('id', user.id)
    if (flagError) throw flagError
  }

  const { error: rolesError } = await admin
    .from('user_roles')
    .upsert(
      spec.roles.map((role) => ({ user_id: user.id, role })),
      { ignoreDuplicates: true },
    )
  if (rolesError) throw rolesError

  return user.id
}

async function findUser(admin: SupabaseClient, email: string) {
  // Every auth user has a profile, and auth stores emails in lower case.
  const { data: profile, error } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle()
  if (error) throw error
  if (!profile) return null

  const { data, error: userError } = await admin.auth.admin.getUserById(profile.id)
  if (userError) throw userError
  return data.user
}

async function createUser(admin: SupabaseClient, spec: UserSpec) {
  const { data, error } = await admin.auth.admin.createUser({
    email: spec.email,
    email_confirm: true,
    user_metadata: { full_name: spec.fullName },
  })
  if (error) throw error
  return data.user
}
