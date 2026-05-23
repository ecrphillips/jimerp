/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Text, Section,
} from 'npm:@react-email/components@0.0.22'

export interface OrderEmailProps {
  orderNumber?: string
  accountName?: string
  requestedShipDate?: string
  headline?: string
  detailsHtml?: string
  notes?: string
}

interface ShellProps extends OrderEmailProps {
  previewText: string
  title: string
}

export const OrderEmailShell = ({
  previewText,
  title,
  orderNumber,
  accountName,
  requestedShipDate,
  headline,
  detailsHtml,
  notes,
}: ShellProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{previewText}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>{title}</Heading>
        {headline ? <Text style={text}>{headline}</Text> : null}
        <Section style={meta}>
          {orderNumber ? (
            <Text style={metaRow}>
              <strong>Order number:</strong> {orderNumber}
            </Text>
          ) : null}
          {accountName ? (
            <Text style={metaRow}>
              <strong>Account:</strong> {accountName}
            </Text>
          ) : null}
          {requestedShipDate ? (
            <Text style={metaRow}>
              <strong>Requested ship date:</strong> {requestedShipDate}
            </Text>
          ) : null}
        </Section>
        {detailsHtml ? (
          <Text style={text}>{detailsHtml}</Text>
        ) : null}
        {notes ? (
          <Text style={text}>
            <strong>Notes:</strong> {notes}
          </Text>
        ) : null}
        <Hr style={hr} />
        <Text style={footer}>
          Home Island Coffee Partners — homeislandcoffee.com
        </Text>
      </Container>
    </Body>
  </Html>
)

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }
const container = { padding: '24px', maxWidth: '600px', margin: '0 auto' }
const h1 = { fontSize: '20px', fontWeight: 'bold' as const, color: '#0B3E5E', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#222222', lineHeight: '1.6', margin: '0 0 16px' }
const meta = { margin: '0 0 16px', padding: '12px 16px', backgroundColor: '#f5f7fa', borderRadius: '4px' }
const metaRow = { fontSize: '14px', color: '#222222', lineHeight: '1.6', margin: '4px 0' }
const hr = { borderColor: '#e6e6e6', margin: '32px 0 16px' }
const footer = { fontSize: '12px', color: '#999999', margin: '0' }
