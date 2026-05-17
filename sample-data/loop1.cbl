       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOOP1.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-I         PIC 9(6)   VALUE 0.
       01  WS-J         PIC 9(6)   VALUE 0.
       01  WS-K         PIC 9(6)   VALUE 0.
       01  WS-TOTAL     PIC 9(18)  VALUE 0.
       01  WS-TEMP      PIC 9(18)  VALUE 0.
       01  WS-FLAG      PIC X      VALUE 'N'.

       PROCEDURE DIVISION.

       MAIN-PARA.
           PERFORM VARYING WS-I FROM 1 BY 1
               UNTIL WS-I > 2000
               PERFORM BUSINESS-LOOP
           END-PERFORM
           STOP RUN.

       BUSINESS-LOOP.
           PERFORM VARYING WS-J FROM 1 BY 1
               UNTIL WS-J > 600
               PERFORM DECISION-LOGIC
           END-PERFORM.

       DECISION-LOGIC.
           IF WS-J > 30000
               MOVE 'Y' TO WS-FLAG
           ELSE
               MOVE 'N' TO WS-FLAG
           END-IF
           PERFORM CALCULATION-LOOP.

       CALCULATION-LOOP.
           PERFORM VARYING WS-K FROM 1 BY 1
               UNTIL WS-K > 20
               PERFORM VARYING WS-J FROM 1 BY 1
                 UNTIL WS-J > 600
                 PERFORM VARYING WS-J FROM 1 BY 1
                   UNTIL WS-J > 600

                IF WS-FLAG = 'Y'
                    COMPUTE WS-TEMP =
                        (WS-I * WS-J) + WS-K
                ELSE
                    COMPUTE WS-TEMP =
                        (WS-I + WS-J) * WS-K
                END-IF
                ADD WS-TEMP TO WS-TOTAL
                 END-PERFORM
               END-PERFORM
           END-PERFORM.


       UNUSED-LOGIC.
           DISPLAY 'THIS IS DEAD CODE - NEVER EXECUTED'.
           MOVE 999999 TO WS-I
           MOVE 999999 TO WS-J
           MOVE 999999 TO WS-K.