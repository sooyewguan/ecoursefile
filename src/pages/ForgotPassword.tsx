import { Link } from 'react-router'
import { AuthLayout } from '@/components/auth-layout'

/** eCourseFile sends no email or SMS, so only an admin can set a forgotten password. */
export function ForgotPassword() {
  return (
    <AuthLayout
      title="Forgot your password?"
      description="Ask an admin of your faculty to reset it. They give you a temporary password, and you choose your own at your next sign-in."
      footer={
        <Link to="/sign-in" className="underline underline-offset-4">
          Back to sign in
        </Link>
      }
    />
  )
}
