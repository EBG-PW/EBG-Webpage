package stats

import (
	"bufio"
	"fmt"
	"log"
	"os/exec"
	"runtime"
	"strconv"
	"strings"

	"github.com/shirou/gopsutil/disk"
)

// DriveStat Struct
type DriveStat struct {
	Name        string            `json:"name"`
	Serial      string            `json:"serial"`
	Status      string            `json:"status"`
	Temp        int               `json:"temp,omitempty"`
	Failing     bool              `json:"failing"`
	RawValues   map[string]string `json:"raw_values,omitempty"`
	Size        uint64            `json:"size"`
	UsedBytes   uint64            `json:"used_bytes"`
	UsedPercent float64           `json:"used_percent"`
}

// Removes any dots from the number and returns it as a string
func cleanNumber(value string) string {
	return strings.ReplaceAll(value, ".", "")
}

// Retrieves the stats for all drives using gopsutil
func GetDriveStats() ([]DriveStat, error) {
	var drives []DriveStat
	var err error

	if runtime.GOOS == "linux" {
		drives, err = getLinuxDriveStats()
		if err != nil {
			return nil, fmt.Errorf("error retrieving Linux drive stats: %v", err)
		}
	} else if runtime.GOOS == "windows" {
		drives, err = getWindowsDriveStats()
		if err != nil {
			return nil, fmt.Errorf("error retrieving Windows drive stats: %v", err)
		}
	} else {
		return nil, fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}

	return drives, nil
}

// Linux-specific drive stats
func getLinuxDriveStats() ([]DriveStat, error) {
	var drives []DriveStat

	physicalDrives, err := listPhysicalDrives()
	if err != nil {
		return nil, fmt.Errorf("failed to list physical drives: %v", err)
	}

	for _, driveName := range physicalDrives {
		drive := DriveStat{
			Name:      driveName,
			Serial:    "", // TODO
			Status:    "UNKNOWN",
			Failing:   false,
			RawValues: make(map[string]string),
		}

		// Get SMART data
		if err := getSmartData(&drive, driveName); err != nil {
			log.Printf("Error getting SMART data for drive %s: %v", driveName, err)
		}

		// Get disk usage
		usage, err := disk.Usage(driveName)
		if err != nil {
			log.Printf("Error getting disk usage for drive %s: %v", driveName, err)
		} else {
			drive.Size = usage.Total
			drive.UsedBytes = usage.Used
			drive.UsedPercent = usage.UsedPercent
		}

		drives = append(drives, drive)
	}

	return drives, nil
}

// Windows-specific drive stats
func getWindowsDriveStats() ([]DriveStat, error) {
	var drives []DriveStat

	partitions, err := disk.Partitions(false)
	if err != nil {
		return nil, err
	}

	for _, part := range partitions {
		usage, err := disk.Usage(part.Mountpoint)
		if err != nil {
			log.Println("Error getting disk usage for partition:", part.Mountpoint, err)
			continue
		}

		drive := DriveStat{
			Name:        part.Device,
			Serial:      "", // TODO
			Status:      "UNKNOWN",
			Failing:     false,
			Size:        usage.Total,
			UsedBytes:   usage.Used,
			UsedPercent: usage.UsedPercent,
			RawValues:   make(map[string]string),
		}

		// Get SMART data
		if err := getSmartData(&drive, part.Device); err != nil {
			log.Println("Error getting SMART data for disk:", part.Device, err)
		}

		drives = append(drives, drive)
	}

	return drives, nil
}

// listPhysicalDrives uses `smartctl --scan` to return a list of physical drives
func listPhysicalDrives() ([]string, error) {
	var drives []string

	cmd := exec.Command("smartctl", "--scan")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to run smartctl --scan: %v", err)
	}

	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "/dev/") {
			fields := strings.Fields(line)
			if len(fields) > 0 {
				drives = append(drives, fields[0])
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return drives, nil
}

// Retrieves SMART data using smartctl (available on both Windows and Linux)
func getSmartData(drive *DriveStat, device string) error {
	// First, use smartctl -H to get the overall health assessment
	healthCmd := exec.Command("smartctl", "-H", device)

	healthOutput, err := healthCmd.Output()
	if err != nil {
		return fmt.Errorf("error executing smartctl -H: %v", err)
	}

	healthLines := strings.Split(string(healthOutput), "\n")
	for _, line := range healthLines {
		if strings.Contains(line, "SMART overall-health self-assessment test result: PASSED") {
			drive.Status = "OK"
			drive.Failing = false
			drive.RawValues["SMART_Health"] = "PASSED"
		} else if strings.Contains(line, "FAILED") {
			drive.Status = "FAILING"
			drive.Failing = true
			drive.RawValues["SMART_Health"] = "FAILED"
		}
	}

	// Optionally still retrieve the detailed SMART attributes with -A if needed
	cmd := exec.Command("smartctl", "-A", device)

	output, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("error executing smartctl -A: %v", err)
	}

	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		fields := strings.Fields(line)

		if len(fields) < 2 {
			continue
		}

		// Handle NVME specific attributes
		switch {
		case strings.HasPrefix(line, "Temperature:"):
			temp, err := strconv.Atoi(fields[1])
			if err == nil {
				drive.Temp = temp
				drive.RawValues["Temperature_Celsius"] = strconv.Itoa(temp)
			}

		case strings.HasPrefix(line, "Data Units Read:"):
			drive.RawValues["Data_Units_Read"] = cleanNumber(fields[3])

		case strings.HasPrefix(line, "Data Units Written:"):
			drive.RawValues["Data_Units_Written"] = cleanNumber(fields[3])

		case strings.HasPrefix(line, "Percentage Used:"):
			percentageUsed := strings.TrimSuffix(fields[2], "%")
			drive.RawValues["Percentage_Used"] = cleanNumber(percentageUsed)

		case strings.HasPrefix(line, "Power Cycles:"):
			drive.RawValues["Power_Cycles"] = cleanNumber(fields[2])

		case strings.HasPrefix(line, "Power On Hours:"):
			drive.RawValues["Power_On_Hours"] = cleanNumber(fields[3])

		case strings.HasPrefix(line, "Unsafe Shutdowns:"):
			drive.RawValues["Unsafe_Shutdowns"] = cleanNumber(fields[2])
		}

		// Handle ATA specific attributes
		switch fields[1] {
		case "Reallocated_Sector_Ct":
			drive.RawValues["Reallocated_Sector_Ct"] = cleanNumber(fields[9])

		case "Power_On_Hours":
			drive.RawValues["Power_On_Hours"] = cleanNumber(fields[9])

		case "Power_Cycle_Count":
			drive.RawValues["Power_Cycle_Count"] = cleanNumber(fields[9])

		case "Airflow_Temperature_Cel", "Temperature_Celsius":
			temp, err := strconv.Atoi(fields[9])
			if err == nil {
				drive.Temp = temp
				drive.RawValues["Temperature_Celsius"] = strconv.Itoa(temp)
			}
		}
	}

	return nil
}
