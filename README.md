# Modbus RTU Master — Web Serial Client

A fully browser-based Modbus RTU master/client tool that communicates with Modbus slave devices over a serial port using the [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API). No installation, no dependencies, no server — just open the HTML file in Chrome or Edge and start querying.

---

## Features

### Serial Communication
- **Web Serial API** — connects directly to RS-232/RS-485 serial ports from the browser (Chrome 89+ / Edge 89+)
- **Configurable port settings** — baud rate (1200–115200), data bits (7/8), stop bits (1/2), parity (none/even/odd)
- **Adjustable timeout** — configurable response timeout from 100ms to 10,000ms
- **CRC-16/Modbus** — automatic CRC generation on transmit and verification on receive

### Supported Function Codes

| Code | Function | Type |
|------|----------|------|
| FC01 | Read Coils | Read |
| FC02 | Read Discrete Inputs | Read |
| FC03 | Read Holding Registers | Read |
| FC04 | Read Input Registers | Read |
| FC05 | Write Single Coil | Write |
| FC06 | Write Single Register | Write |
| FC15 | Write Multiple Coils | Write |
| FC16 | Write Multiple Registers | Write |

### Per-Register Data Type Interpretation

When reading registers (FC03/FC04), each register in the response can be individually assigned a data type for interpretation. The following types are supported:

| Type | Size | Registers Used |
|------|------|---------------|
| 8-bit INT | 8-bit signed | 1 |
| 16-bit INT | 16-bit signed | 1 |
| 32-bit INT | 32-bit signed | 2 |
| 8-bit UINT | 8-bit unsigned | 1 |
| 16-bit UINT | 16-bit unsigned | 1 |
| 32-bit UINT | 32-bit unsigned | 2 |
| 64-bit UINT | 64-bit unsigned | 4 |
| 32-bit Float | IEEE 754 single | 2 |
| 64-bit Float | IEEE 754 double | 4 |
| String4 | 4-char ASCII | 2 |
| String6 | 6-char ASCII | 3 |
| String8 | 8-char ASCII | 4 |
| String12 | 12-char ASCII | 6 |
| String16 | 16-char ASCII | 8 |

Multi-register types (32-bit, 64-bit, strings) automatically span the correct number of consecutive registers. A **"Copy #1 → All"** button lets you set the first register's type and apply it to every register in one click.

**Byte order** options for multi-byte types:
- Big-Endian (AB CD) — most common
- Little-Endian (BA DC)
- Mid-Big / Word-Swap (CD AB)
- Mid-Little / Byte-Word-Swap (DC BA)

### Minus Offset

Many Modbus device manuals use documentation addresses like 40001 for the first holding register, but the actual Modbus protocol uses 0-based addressing. The **Minus Offset** feature bridges this gap:

- Enter the documentation address (e.g. `40001`) as the **Start Address**
- Set the **Offset Value** to `40001`
- The tool subtracts the offset and sends wire address `0` on the protocol
- The response table still displays your original documentation addresses

A live preview shows the calculated wire address before you send, and the communication log displays both addresses when offset is active.

### Auto-Polling

Enable automatic repeated querying at a configurable interval (100ms–60,000ms). Useful for monitoring live values. Toggle on/off with a checkbox — the tool will re-send the current query at each interval.

### Device Profiles

Create named profiles to label registers, coils, and inputs for specific Modbus slave devices. Profiles make the response data table much more readable by showing human-friendly names alongside raw addresses.

Each profile stores:
- **Profile Name** — Identifies the device (e.g. "Schneider PM5110")
- **Slave ID** — The device's Modbus address, automatically applied when the profile is loaded

Each profile entry defines:
- **Type** — Coil, Discrete Input, Holding Register, or Input Register
- **Address** — The register/coil address (using documentation addressing, e.g. 40001)
- **Label** — A human-readable name (e.g. "Motor Speed", "Tank Level", "Alarm Status")
- **Data Type** — Optionally pre-assign a data type (overrides the default uint16 for registers)

**Automatic FC tab configuration:** When a profile is active and you click a function code tab, the tool automatically:
- Sets the **Start Address** to the lowest address defined in the profile for that register type
- Sets the **Quantity** to cover all defined addresses (accounting for multi-register data types)
- Enables **Minus Offset** with the standard base address (1 for coils, 10001 for discrete inputs, 30001 for input registers, 40001 for holding registers)

This means you can simply load a profile, click a FC tab, and immediately send a query — no manual address configuration needed.

Profile management features:
- **Save** — Stores profiles in the browser's localStorage for persistence across sessions
- **Export JSON** — Downloads the profile as a `.json` file for backup or sharing
- **Import JSON** — Loads a previously exported profile file
- **Load / Delete** — Manage saved profiles from the list in the profile editor
- **Clear Active** — Removes the currently active profile without deleting it from storage

When a profile is active, a pink badge appears in the header showing the profile name, and a **Label** column is added to the response data table. Profile data types are automatically applied to the per-register type selectors. If the profile has no entries for a particular FC tab, an info message is shown with a link to edit the profile — the manual address fields remain available for direct queries.

Switching FC tabs or changing profiles clears the Response Data area, so it's always clear that a fresh query is needed to populate results for the current context.

### Raw Response Frame

Every response is displayed in three formats:
- **HEX** — space-separated hexadecimal bytes
- **BIN** — space-separated 8-bit binary bytes
- **ASCII** — printable characters with `·` for non-printable bytes

### Error Handling

- **Timeout** — clear message when no response is received
- **CRC errors** — detected and reported with guidance to check wiring/baud rate
- **Modbus exceptions** — decoded by name (Illegal Function, Illegal Data Address, Illegal Data Value, Slave Device Failure)
- **Validation errors** — caught before sending (invalid register values, etc.)

When an error occurs, the response data table is replaced with a clear error message to prevent confusion with stale data.

### Collapsible Sections

The following sections can be collapsed/expanded by clicking their headers to reduce clutter:
- Response Data
- Data Type per Register
- Raw Response Frame
- Communication Log

### Communication Log

Timestamped log of all TX (sent), RX (received), and error events with full hex frame data and timing information. Includes a clear button and collapse toggle.

---

## Requirements

- **Browser:** Google Chrome 89+ or Microsoft Edge 89+
- **Serial adapter:** Any USB-to-RS232 or USB-to-RS485 adapter recognised by the operating system
- **No server or installation required** — runs entirely in the browser from a local file

> **Note:** The Web Serial API is not supported in Firefox or Safari.

---

## Getting Started

1. **Open** `modbus-master.html` in Chrome or Edge
2. **Configure** serial port settings (baud rate, data bits, stop bits, parity) in the sidebar
3. **Click "Connect"** — the browser will prompt you to select a serial port
4. **Set** the slave ID, start address, and quantity
5. **Select** a function code tab (FC01–FC16)
6. **Click "Send Query"** to execute the Modbus request
7. **View** the response in the data table, with optional data type interpretation

### Using Minus Offset

1. Check **"Enable Minus Offset"** in the sidebar
2. Enter the offset value (e.g. `40001` for holding registers, `10001` for discrete inputs, `30001` for input registers)
3. Enter your documentation address as the **Start Address**
4. The wire preview below will show the calculated protocol address
5. Send queries as normal — the tool handles the address translation

### Using Data Types

1. Send a register read query (FC03 or FC04)
2. The **"Data Type per Register"** section appears with a dropdown for each register
3. Select the desired type for each register (or set the first and click **"Copy #1 → All"**)
4. Choose the byte order if working with multi-byte types
5. The table updates automatically to show the interpreted values

### Using Device Profiles

1. Click the **"Profiles"** button in the header
2. Enter a **profile name** (e.g. "Schneider PM5110") and the device's **Slave ID**
3. Click **"+ Add Entry"** to define each register/coil label:
   - Select the type (Coil, Discrete, Holding, Input)
   - Enter the address number (use documentation addresses, e.g. 40001 for holding register 0)
   - Type a descriptive label
   - Optionally choose a data type (for registers)
4. Click **"Save Profile"** to store it locally and activate it
5. Now simply click any **FC tab** — the start address, quantity, and minus offset are auto-configured from the profile
6. Click **"Send Query"** — the Label column shows your defined names in results
7. To share profiles, use **"Export JSON"** and **"Import JSON"**

### Using Auto-Polling

1. Ensure you are connected to a serial port
2. Set the desired polling interval in milliseconds
3. Check **"Enable Auto-Polling"** to start
4. Uncheck to stop polling

### Write Operations

1. Select a write function code (FC05, FC06, FC15, or FC16) — the button changes to **"Send Update"**
2. **With a profile active:** A picker list shows all labelled registers/coils for the selected type. Click to select which ones to write, enter values inline, then click Send Update. For non-contiguous selections (e.g. registers 1 and 3 but not 2), the tool sends individual write commands to avoid overwriting unselected registers.
3. **Without a profile (or no entries for that type):** The manual value input appears with guidance for the expected format:
   - **FC05 (Single Coil):** `1`, `0`, `true`, `false`, `on`, `off`
   - **FC06 (Single Register):** An integer between 0 and 65535
   - **FC15 (Multiple Coils):** Comma or space-separated `1`/`0` values
   - **FC16 (Multiple Registers):** Comma or space-separated integers (0–65535)
4. Click **"Send Update"** to execute the write

Auto-polling is automatically stopped when switching to a write FC tab to prevent accidental repeated writes.

---

## File Structure

```
modbus-master.html    — Main application (single self-contained HTML file)
download-fonts.sh     — Script to fetch font files locally
README.md             — This file
fonts/                — Local font files (created by download-fonts.sh)
  JetBrainsMono-*.woff2
  Outfit-*.woff2
```

No external dependencies, build steps, or server required. All HTML, CSS, and JavaScript are inline. Fonts are loaded locally with no external network requests.

---

## Browser Compatibility

| Browser | Supported |
|---------|-----------|
| Google Chrome 89+ | ✅ |
| Microsoft Edge 89+ | ✅ |
| Opera 76+ | ✅ |
| Firefox | ❌ (no Web Serial API) |
| Safari | ❌ (no Web Serial API) |

---

## Acknowledgements

- **Fonts:** [JetBrains Mono](https://www.jetbrains.com/lp/mono/) and [Outfit](https://fonts.google.com/specimen/Outfit) — both licensed under the [SIL Open Font License 1.1](https://scripts.sil.org/OFL). Loaded locally from the `fonts/` directory (no external requests to Google Fonts).
- **Web Serial API:** A native browser API provided by Chromium-based browsers

---

## License

This project is released under [The Unlicense](https://unlicense.org/) — dedicated to the public domain.

You are free to copy, modify, publish, use, compile, sell, or distribute this software for any purpose, commercial or non-commercial, without restriction.

See the **About** dialog within the application for the full license text.
