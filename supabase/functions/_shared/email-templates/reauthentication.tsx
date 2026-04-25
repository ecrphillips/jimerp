/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your verification code for Home Island Coffee Partners</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Verification code</Heading>
        <Text style={text}>
          Use the code below to confirm your identity for Home Island Coffee
          Partners:
        </Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={text}>
          This code will expire shortly. If you didn't request this, you can
          safely ignore this email.
        </Text>
        <Hr style={hr} />
        <Text style={footer}>
          Home Island Coffee Partners — homeislandcoffee.com
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

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
const codeStyle = {
  fontFamily: 'Courier, monospace',
  fontSize: '24px',
  fontWeight: 'bold' as const,
  color: '#0B3E5E',
  letterSpacing: '2px',
  margin: '16px 0 24px',
}
const hr = { borderColor: '#e6e6e6', margin: '32px 0 16px' }
const footer = { fontSize: '12px', color: '#999999', margin: '0' }
