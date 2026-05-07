import socket
print(socket.gethostbyname('elitedial.xyz'))


import socket

def get_ip_from_url(url):
    try:
        ip = socket.gethostbyname(url)
        print(f"The IP address of {url} is: {ip}")
    except socket.gaierror as e:
        print(f"Unable to get IP for {url}. Error: {e}")

get_ip_from_url("elitedial.xyz")