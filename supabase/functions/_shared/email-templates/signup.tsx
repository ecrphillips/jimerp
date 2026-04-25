/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email for Home Island Coffee Partners</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Confirm your email</Heading>
        <Text style={text}>
          You're receiving this email because an account was created for{' '}
          {recipient} at Home Island Coffee Partners.
        </Text>
        <Text style={text}>
          Please confirm your email address to activate your account:
        </Text>
        <Button style={button} href={confirmationUrl}>
          Confirm email
        </Button>
        <Text style={textSmall}>
          If the button doesn't work, copy and paste this link into your browser:
          <br />
          {confirmationUrl}
        </Text>
        <Text style={text}>
          If you didn't expect this email, you can safely ignore it.
        </Text>
        <Hr style={hr} />
        <Text style={footer}>
          Home Island Coffee Partners — homeislandcoffee.com
        </Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }
const container = { padding: '24px', maxWidth: '560px', margin: '0 auto' }
const h1 = {
  fontSize: '20px',
  fontWeight: 'bold' as const,
  color: '#0B3E5E',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: '#222222',
  lineHeight: '1.6',
  margin: '0 0 16px',
}
const textSmall = {
  fontSize: '12px',
  color: '#666666',
  lineHeight: '1.5',
  margin: '16px 0',
  wordBreak: 'break-all' as const,
}
const button = {
  backgroundColor: '#0B3E5E',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 'bold' as const,
  borderRadius: '4px',
  padding: '12px 20px',
  textDecoration: 'none',
  display: 'inline-block',
  margin: '8px 0 16px',
}
const hr = { borderColor: '#e6e6e6', margin: '32px 0 16px' }
const footer = { fontSize: '12px', color: '#999999', margin: '0' }
